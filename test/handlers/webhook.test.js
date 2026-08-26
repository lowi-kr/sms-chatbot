import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/core/processMessage.js', () => ({ processMessage: vi.fn().mockResolvedValue(undefined) }));
import { processMessage } from '../../src/core/processMessage.js';
import { handleWebhook } from '../../src/handlers/webhook.js';
import { makeCtx, makeEnv } from '../helpers/env.js';

const request = body => new Request('https://example.com/webhook', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
describe('webhook handler', () => {
  it('returns 400 for invalid JSON and ignores irrelevant/incomplete events', async () => {
    expect((await handleWebhook(new Request('https://x', { method: 'POST', body: '{' }), makeEnv(), makeCtx())).status).toBe(400);
    expect((await handleWebhook(request({ data: { event_type: 'other' } }), makeEnv(), makeCtx())).status).toBe(200);
    expect((await handleWebhook(request({ data: { event_type: 'message.received', payload: { text: 'hi' } } }), makeEnv(), makeCtx())).status).toBe(200);
    expect(processMessage).not.toHaveBeenCalled();
  });
  it('schedules valid messages with sender and text', async () => {
    const ctx = makeCtx();
    expect((await handleWebhook(request({ data: { event_type: 'message.received', payload: { from: { phone_number: '+1' }, to: [{ phone_number: '+2' }], text: 'hello' } } }), makeEnv(), ctx)).status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalled();
    expect(processMessage).toHaveBeenCalledWith(expect.anything(), ctx, '+1', 'hello');
  });
});
