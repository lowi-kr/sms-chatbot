import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleContacts } from '../../src/admin/contacts.js';
import { handleLists } from '../../src/admin/lists.js';
import { handleModels } from '../../src/admin/models.js';
import { handleNumbers } from '../../src/admin/numbers.js';
import { handleSend } from '../../src/admin/send.js';
import { handleSettings } from '../../src/admin/settings.js';
import { handleStats } from '../../src/admin/stats.js';
import { handleSupport } from '../../src/admin/support.js';
import { makeDb } from '../helpers/fakeDb.js';
import { makeEnv } from '../helpers/env.js';

const sendSMS = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/telnyx.js', () => ({ sendSMS }));

const req = (method = 'GET', body) => new Request('https://example.com', {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const json = response => response.json();
const dbError = message => makeDb([{ match: 'SELECT', error: new Error(message) }]);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('admin contacts routes', () => {
  it('matches contact, conversation, and support paths and binds phone numbers', async () => {
    expect(await handleContacts(req(), makeEnv(), '/api/nope')).toBeNull();
    const contacts = makeDb([{ match: 'FROM conversations c', all: [{ phone_number: '+1', conversation_count: 2 }] }]);
    await expect(json(await handleContacts(req(), { DB: contacts }, '/api/contacts'))).resolves.toEqual([{ phone_number: '+1', conversation_count: 2 }]);

    const conversations = makeDb([{ match: 'WHERE c.phone_number', all: [{ id: 3 }] }]);
    await handleContacts(req(), { DB: conversations }, '/api/contacts/%2B1555/conversations');
    expect(conversations.calls[0].args).toEqual(['+1555']);

    const support = makeDb([{ match: 'WHERE phone_number', all: [{ id: 4 }] }]);
    await handleContacts(req(), { DB: support }, '/api/contacts/%2B1555/support');
    expect(support.calls[0].args).toEqual(['+1555']);
  });

  it('returns a dbTry 500 response with the real database error', async () => {
    const response = await handleContacts(req(), { DB: dbError('contacts failed') }, '/api/contacts');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'contacts failed' });
  });
});

describe('admin blacklist and whitelist routes', () => {
  it('supports list, create, delete, validation, and fallthrough for both lists', async () => {
    expect(await handleLists(req(), makeEnv(), '/api/other')).toBeNull();
    const blacklist = makeDb([{ match: 'FROM blacklist', all: [{ phone_number: '+1' }] }]);
    await expect(json(await handleLists(req(), { DB: blacklist }, '/api/blacklist'))).resolves.toEqual([{ phone_number: '+1' }]);

    const missingBlacklist = await handleLists(req('POST', {}), { DB: makeDb() }, '/api/blacklist');
    expect(missingBlacklist.status).toBe(400);
    const addBlacklist = makeDb([{ match: 'INSERT OR IGNORE INTO blacklist' }]);
    await handleLists(req('POST', { phone_number: '+1', reason: 'spam' }), { DB: addBlacklist }, '/api/blacklist');
    expect(addBlacklist.calls[0].args).toEqual(['+1', 'spam']);
    const deleteBlacklist = makeDb([{ match: 'DELETE FROM blacklist' }]);
    await handleLists(req('DELETE'), { DB: deleteBlacklist }, '/api/blacklist/%2B1');
    expect(deleteBlacklist.calls[0].args).toEqual(['+1']);

    const whitelist = makeDb([{ match: 'FROM whitelist', all: [{ phone_number: '+2' }] }]);
    await expect(json(await handleLists(req(), { DB: whitelist }, '/api/whitelist'))).resolves.toEqual([{ phone_number: '+2' }]);
    expect((await handleLists(req('POST', {}), { DB: makeDb() }, '/api/whitelist')).status).toBe(400);
    const addWhitelist = makeDb([{ match: 'INSERT OR IGNORE INTO whitelist' }]);
    await handleLists(req('POST', { phone_number: '+2' }), { DB: addWhitelist }, '/api/whitelist');
    expect(addWhitelist.calls[0].args).toEqual(['+2', '']);
    const deleteWhitelist = makeDb([{ match: 'DELETE FROM whitelist' }]);
    await handleLists(req('DELETE'), { DB: deleteWhitelist }, '/api/whitelist/%2B2');
    expect(deleteWhitelist.calls[0].args).toEqual(['+2']);
  });

  it('surfaces list database errors as 500 JSON', async () => {
    const response = await handleLists(req(), { DB: dbError('blacklist failed') }, '/api/blacklist');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'blacklist failed' });
  });
});

describe('admin model route', () => {
  it('returns null for other paths, reports fetch errors, slims and caches models', async () => {
    expect(await handleModels(req(), makeEnv(), '/api/other')).toBeNull();
    expect(await handleModels(req('POST'), makeEnv(), '/api/openrouter-models')).toBeNull();
    fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const failed = await handleModels(req(), makeEnv(), '/api/openrouter-models');
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: 'Failed to fetch model list', detail: 'OpenRouter models fetch failed: 503' });

    fetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { id: 'z/model:free', name: 'Zed', context_length: 4, pricing: { prompt: '0', completion: '1' } },
          { id: 'a/model', name: 'A', context_length: 8, pricing: {} },
        ],
      }),
    });
    const response = await handleModels(req(), makeEnv(), '/api/openrouter-models');
    await expect(response.json()).resolves.toEqual([
      { id: 'a/model', name: 'A', context_length: 8, is_free: false, prompt_price: null, completion_price: null },
      { id: 'z/model:free', name: 'Zed', context_length: 4, is_free: true, prompt_price: '0', completion_price: '1' },
    ]);
    await handleModels(req(), makeEnv(), '/api/openrouter-models');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('admin number routes', () => {
  it('lists numbers and binds model, fallback, limit, and reset updates', async () => {
    expect(await handleNumbers(req(), makeEnv(), '/api/other')).toBeNull();
    const list = makeDb([{ match: 'FROM (SELECT DISTINCT phone_number', all: [{ phone_number: '+1', token_limit: 0 }] }]);
    await expect(json(await handleNumbers(req(), { DB: list }, '/api/numbers'))).resolves.toEqual([{ phone_number: '+1', token_limit: 0 }]);

    const model = makeDb([{ match: 'INSERT INTO number_settings', }]);
    await handleNumbers(req('POST', { model: '' }), { DB: model }, '/api/numbers/%2B1/model');
    expect(model.calls[0].args).toEqual(['+1', null]);
    const fallback = makeDb([{ match: 'INSERT INTO number_settings' }]);
    await handleNumbers(req('POST', {}), { DB: fallback }, '/api/numbers/%2B1/fallback');
    expect(fallback.calls[0].args).toEqual(['+1', null]);
    const limit = makeDb([{ match: 'INSERT INTO number_settings' }]);
    await handleNumbers(req('POST', { token_limit: '' }), { DB: limit }, '/api/numbers/%2B1/limit');
    expect(limit.calls[0].args).toEqual(['+1', null]);
    const zero = makeDb([{ match: 'INSERT INTO number_settings' }]);
    await handleNumbers(req('POST', { token_limit: '0' }), { DB: zero }, '/api/numbers/%2B1/limit');
    expect(zero.calls[0].args).toEqual(['+1', 0]);
    const reset = makeDb([{ match: 'INSERT INTO number_settings' }]);
    await handleNumbers(req('POST'), { DB: reset }, '/api/numbers/%2B1/reset-usage');
    expect(reset.calls[0].args).toEqual(['+1']);
  });

  it('returns 500 JSON when number settings fail', async () => {
    const response = await handleNumbers(req(), { DB: dbError('numbers failed') }, '/api/numbers');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'numbers failed' });
  });
});

describe('admin send route', () => {
  it('validates, falls through, sends through Telnyx, and reports errors', async () => {
    const env = makeEnv();
    expect(await handleSend(req(), env, '/api/other')).toBeNull();
    expect(await handleSend(req('GET'), env, '/api/send')).toBeNull();
    expect((await handleSend(req('POST', {}), env, '/api/send')).status).toBe(400);
    sendSMS.mockResolvedValue({ data: { id: 'msg-1' } });
    const response = await handleSend(req('POST', { to: '+1', message: 'hello' }), env, '/api/send');
    expect(sendSMS).toHaveBeenCalledWith(env, '+1', 'hello');
    await expect(response.json()).resolves.toEqual({ success: true, message_id: 'msg-1' });
    sendSMS.mockRejectedValue(new Error('Telnyx unavailable'));
    const failed = await handleSend(req('POST', { to: '+1', message: 'hello' }), env, '/api/send');
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: 'Telnyx unavailable' });
  });
});

describe('admin settings route', () => {
  it('returns defaults or stored values and persists valid updates', async () => {
    expect(await handleSettings(req(), makeEnv(), '/api/other')).toBeNull();
    const db = makeDb([{ match: 'SELECT key, value', all: [
      { key: 'ai_model', value: '' },
      { key: 'default_fallback_model', value: 'fallback' },
      { key: 'default_token_limit', value: '' },
    ] }]);
    const response = await handleSettings(req(), { DB: db }, '/api/settings');
    await expect(response.json()).resolves.toMatchObject({
      ai_model: 'openrouter/free',
      default_fallback_model: 'fallback',
      default_token_limit: '',
      memory_extraction_threshold: '10',
    });

    expect((await handleSettings(req('POST', { unknown: 'x' }), { DB: makeDb() }, '/api/settings')).status).toBe(400);
    const updates = makeDb([{ match: 'INSERT INTO settings' }]);
    await handleSettings(req('POST', { ai_model: 'm', default_token_limit: 0, unknown: 'x' }), { DB: updates }, '/api/settings');
    expect(updates.calls.map(call => call.args)).toEqual([['ai_model', 'm'], ['default_token_limit', '0']]);
  });

  it('returns the real settings database error', async () => {
    const response = await handleSettings(req(), { DB: dbError('settings failed') }, '/api/settings');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'settings failed' });
  });
});

describe('admin stats route', () => {
  it('returns all dashboard counts and falls through other paths', async () => {
    expect(await handleStats(req(), makeEnv(), '/api/other')).toBeNull();
    const db = makeDb([
      { match: 'total_messages', first: { total_messages: 10, total_conversations: 4 } },
      { match: "created_at >= datetime('now', '-1 day')", first: { count: 3 } },
      { match: 'is_active = 1', first: { count: 2 } },
      { match: 'FROM blacklist', first: { count: 1 } },
      { match: 'FROM whitelist', first: { count: 5 } },
      { match: "status = 'open'", first: { count: 6 } },
    ]);
    const response = await handleStats(req(), { DB: db }, '/api/stats');
    await expect(response.json()).resolves.toEqual({
      total_messages: 10, total_conversations: 4, messages_today: 3,
      active_conversations: 2, blacklisted: 1, whitelisted: 5, open_support_tickets: 6,
    });
  });

  it('returns stats database errors as 500 JSON', async () => {
    const response = await handleStats(req(), { DB: dbError('stats failed') }, '/api/stats');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'stats failed' });
  });
});

describe('admin support routes', () => {
  it('lists, closes, counts, validates affected rows, and falls through', async () => {
    expect(await handleSupport(req(), makeEnv(), '/api/other')).toBeNull();
    const list = makeDb([{ match: 'FROM support_tickets', all: [{ id: 1, status: 'open' }] }]);
    await expect(json(await handleSupport(req(), { DB: list }, '/api/support'))).resolves.toEqual([{ id: 1, status: 'open' }]);

    const missing = makeDb([{ match: 'UPDATE support_tickets', run: { meta: { changes: 0 } } }]);
    const notFound = await handleSupport(req('POST'), { DB: missing }, '/api/support/3/close');
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.toEqual({ error: 'Ticket not found or already closed' });
    const close = makeDb([{ match: 'UPDATE support_tickets', run: { meta: { changes: 1 } } }]);
    await expect(json(await handleSupport(req('POST'), { DB: close }, '/api/support/3/close'))).resolves.toEqual({ success: true });
    expect(close.calls[0].args).toEqual(['3']);

    const count = makeDb([{ match: 'COUNT(*) as count', first: { count: 7 } }]);
    await expect(json(await handleSupport(req(), { DB: count }, '/api/support/open-count'))).resolves.toEqual({ count: 7 });
  });

  it('returns support database errors as 500 JSON', async () => {
    const response = await handleSupport(req(), { DB: dbError('support failed') }, '/api/support');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'support failed' });
  });
});
