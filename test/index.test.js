import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleWebhook = vi.hoisted(() => vi.fn());
const handleTestUi = vi.hoisted(() => vi.fn());
const handleTestCors = vi.hoisted(() => vi.fn());
const handleTestPost = vi.hoisted(() => vi.fn());
const handleAdminRequest = vi.hoisted(() => vi.fn());

vi.mock('../src/handlers/webhook.js', () => ({ handleWebhook }));
vi.mock('../src/handlers/testRoute.js', () => ({ handleTestUi, handleTestCors, handleTestPost }));
vi.mock('../src/admin/index.js', () => ({ handleAdminRequest }));

import worker from '../src/index.js';
import { makeEnv } from './helpers/env.js';

const env = makeEnv();
const ctx = { waitUntil: vi.fn() };
const request = (path, options = {}) => new Request(`https://example.com${path}`, options);

beforeEach(() => {
  vi.clearAllMocks();
  handleTestUi.mockResolvedValue(new Response('ui'));
  handleTestCors.mockResolvedValue(new Response('cors'));
  handleTestPost.mockResolvedValue(new Response('test'));
  handleWebhook.mockResolvedValue(new Response('webhook'));
  handleAdminRequest.mockResolvedValue(new Response('admin'));
});

describe('worker entrypoint routing', () => {
  it('serves health and dispatches each supported route', async () => {
    const health = await worker.fetch(request('/health'), env, ctx);
    expect(health.status).toBe(200);
    await expect(health.text()).resolves.toBe('OK');

    await worker.fetch(request('/test-ui'), env, ctx);
    expect(handleTestUi).toHaveBeenCalledWith(env);

    await worker.fetch(request('/test', { method: 'OPTIONS' }), env, ctx);
    expect(handleTestCors).toHaveBeenCalled();

    const postTest = request('/test', { method: 'POST', body: '{}' });
    await worker.fetch(postTest, env, ctx);
    expect(handleTestPost).toHaveBeenCalledWith(postTest, env, ctx);

    const webhook = request('/webhook', { method: 'POST', body: '{}' });
    await worker.fetch(webhook, env, ctx);
    expect(handleWebhook).toHaveBeenCalledWith(webhook, env, ctx);

    const adminRequest = request('/api/settings', { method: 'GET' });
    await worker.fetch(adminRequest, env, ctx);
    expect(handleAdminRequest).toHaveBeenCalledWith(adminRequest, env);
  });

  it('returns 404 for unknown paths and method-gated routes', async () => {
    for (const req of [
      request('/webhook'),
      request('/test'),
      request('/test-ui', { method: 'POST', body: 'x' }),
      request('/not-real'),
    ]) {
      const response = await worker.fetch(req, env, ctx);
      expect(response.status).toBe(404);
    }
    expect(handleWebhook).not.toHaveBeenCalled();
    expect(handleTestUi).not.toHaveBeenCalled();
    expect(handleTestCors).not.toHaveBeenCalled();
    expect(handleTestPost).not.toHaveBeenCalled();
  });
});
