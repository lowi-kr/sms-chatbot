import { beforeEach, describe, expect, it, vi } from 'vitest';

const processMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/processMessage.js', () => ({ processMessage }));

import { handleTestCors, handleTestPost, handleTestUi } from '../../src/handlers/testRoute.js';
import { makeCtx, makeEnv } from '../helpers/env.js';

beforeEach(() => {
  vi.clearAllMocks();
  processMessage.mockResolvedValue({ status: 'ok', reply: 'done' });
});

describe('test routes', () => {
  it('gates the UI and POST endpoint on the exact TEST_MODE value', async () => {
    const disabled = makeEnv({ TEST_MODE: 'false' });
    expect((await handleTestUi(disabled)).status).toBe(404);
    expect((await handleTestPost(new Request('https://x', { method: 'POST', body: '{}' }), disabled, makeCtx())).status).toBe(404);

    const enabled = makeEnv({ TEST_MODE: 'true' });
    const ui = await handleTestUi(enabled);
    expect(ui.status).toBe(200);
    expect(ui.headers.get('Content-Type')).toContain('text/html');
    expect(await ui.text()).toContain('<!DOCTYPE html>');
  });

  it('returns CORS headers for preflight', async () => {
    // The current handler does not receive env, so OPTIONS remains available even when TEST_MODE is disabled.
    const response = handleTestCors(makeEnv({ TEST_MODE: 'false' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });

  it('validates JSON bodies and required fields', async () => {
    const env = makeEnv();
    const badJson = await handleTestPost(new Request('https://x', { method: 'POST', body: '{' }), env, makeCtx());
    expect(badJson.status).toBe(400);
    await expect(badJson.text()).resolves.toContain('from');

    const missingText = await handleTestPost(new Request('https://x', {
      method: 'POST',
      body: JSON.stringify({ from: '+1' }),
    }), env, makeCtx());
    expect(missingText.status).toBe(400);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('passes the model override and returns success and error result shapes', async () => {
    const env = makeEnv();
    const ctx = makeCtx();
    const req = new Request('https://x', {
      method: 'POST',
      body: JSON.stringify({ from: '+1555', text: 'hello', model: 'custom/model' }),
    });
    const success = await handleTestPost(req, env, ctx);
    expect(processMessage).toHaveBeenCalledWith(env, ctx, '+1555', 'hello', true, 'custom/model');
    expect(success.headers.get('Content-Type')).toContain('application/json');
    await expect(success.json()).resolves.toEqual({ status: 'ok', reply: 'done' });

    processMessage.mockResolvedValue({ status: 'error', error: 'database down' });
    const errorResponse = await handleTestPost(new Request('https://x', {
      method: 'POST',
      body: JSON.stringify({ from: '+1555', text: 'again' }),
    }), env, ctx);
    expect(processMessage).toHaveBeenLastCalledWith(env, ctx, '+1555', 'again', true, null);
    expect(errorResponse.status).toBe(200);
    await expect(errorResponse.json()).resolves.toEqual({ status: 'error', error: 'database down' });
  });
});
