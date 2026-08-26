import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInboundWebhook, sendMMS, sendSMS } from '../../src/integrations/telnyx.js';
import { makeEnv } from '../helpers/env.js';

const env = makeEnv();
beforeEach(() => vi.restoreAllMocks());

describe('telnyx', () => {
  it('parses inbound payloads and defaults optional fields', () => {
    expect(parseInboundWebhook(null)).toBeNull();
    expect(parseInboundWebhook({ data: {} })).toBeNull();
    expect(parseInboundWebhook({ data: { payload: { from: { phone_number: 'a' }, to: [{ phone_number: 'b' }], text: 'hi', media: [{ url: 'u' }], id: 'id', direction: 'inbound' } } })).toEqual({ from: 'a', to: 'b', text: 'hi', mediaUrls: ['u'], messageId: 'id', direction: 'inbound' });
    expect(parseInboundWebhook({ data: { payload: { from: {}, to: [] } } })).toMatchObject({ text: '', mediaUrls: [], to: undefined });
  });
  it('sends SMS and MMS with the expected request body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) }));
    await sendSMS(env, '+1', 'hello');
    let body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe('https://api.telnyx.com/v2/messages');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${env.TELNYX_API_KEY}`);
    expect(body).toEqual({ from: env.TELNYX_PHONE_NUMBER, to: '+1', text: 'hello' });
    await sendMMS(env, '+1', 'pic', 'https://x');
    expect(JSON.parse(fetch.mock.calls[1][1].body).media_urls).toEqual(['https://x']);
  });
  it('logs response body and throws status, even when body is unreadable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: vi.fn().mockResolvedValue('bad') }));
    await expect(sendSMS(env, '+1', 'x')).rejects.toThrow('Telnyx API error: 422');
    expect(error).toHaveBeenCalledWith('Telnyx send error:', 'bad');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockRejectedValue(new Error('no body')) }));
    await expect(sendSMS(env, '+1', 'x')).rejects.toThrow('Telnyx API error: 500');
  });
});
