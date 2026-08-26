import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEffectiveConfig = vi.hoisted(() => vi.fn());
const recordTokenUsage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/db/index.js', () => ({ getEffectiveConfig, recordTokenUsage }));

import { extractMemory, generateConversationTitle, getOpenRouterResponse } from '../../../src/integrations/providers/openrouter.js';
import { makeEnv } from '../../helpers/env.js';

const env = makeEnv();
const response = (body, ok = true, status = 200) => ({
  ok, status, json: vi.fn().mockResolvedValue(body),
  text: vi.fn().mockResolvedValue('error'),
});
const answer = (text = 'reply', model = 'model') => response({
  model, choices: [{ message: { content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 2, completion_tokens: 3 },
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: 'fallback', isOverLimit: false });
  recordTokenUsage.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn());
});

describe('getOpenRouterResponse', () => {
  it('builds system, history, and user messages and records usage', async () => {
    fetch.mockResolvedValue(answer());
    const result = await getOpenRouterResponse(env, 'p', [{ role: 'user', content: 'old' }], 'new');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(result).toMatchObject({ text: 'reply', modelUsed: 'model', inputTokens: 2, outputTokens: 3 });
    expect(body.messages.map(m => m.content)).toEqual([expect.stringContaining('helpful'), 'old', 'new']);
    expect(recordTokenUsage).toHaveBeenCalledWith(env.DB, 'p', 2, 3);
  });
  it('injects memory facts into the system prompt', async () => {
    fetch.mockResolvedValue(answer());
    await getOpenRouterResponse(env, 'p', [], 'new', null, ['Likes tea']);
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[0].content).toContain('Likes tea');
  });
  it('blocks without fetching when over limit and fallback is block', async () => {
    getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: 'block', isOverLimit: true });
    const result = await getOpenRouterResponse(env, 'p', [], 'new');
    expect(result.blocked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a fallback model with a limit notice', async () => {
    getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: 'light', isOverLimit: true });
    fetch.mockResolvedValue(answer('reply', 'light'));
    const result = await getOpenRouterResponse(env, 'p', [], 'new');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('light');
    expect(result.text).toContain("message limit");
  });
  it('falls back after a primary error with an error notice', async () => {
    fetch.mockResolvedValueOnce(response({}, false, 500)).mockResolvedValueOnce(answer());
    const result = await getOpenRouterResponse(env, 'p', [], 'new');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe('fallback');
    expect(result.text).toContain('hiccup');
  });
  it('rethrows when fallback is block or absent', async () => {
    fetch.mockResolvedValue(response({}, false, 503));
    getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: 'block', isOverLimit: false });
    await expect(getOpenRouterResponse(env, 'p', [], 'new')).rejects.toThrow('503');
    getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: null, isOverLimit: false });
    await expect(getOpenRouterResponse(env, 'p', [], 'new')).rejects.toThrow('503');
  });
  it('handles content filtering, truncation, empty choices, and usage errors', async () => {
    fetch.mockResolvedValue(response({ model: 'm', choices: [{ finish_reason: 'content_filter' }], usage: { prompt_tokens: 1, completion_tokens: 0 } }));
    expect((await getOpenRouterResponse(env, 'p', [], 'x')).text).toContain("can't respond");
    fetch.mockResolvedValue(answer('x'.repeat(1000)));
    expect((await getOpenRouterResponse(env, 'p', [], 'x')).text).toHaveLength(950);
    expect((await getOpenRouterResponse(env, 'p', [], 'x')).text.endsWith('...')).toBe(true);
    getEffectiveConfig.mockResolvedValue({ model: 'p', fallbackModel: 'f', isOverLimit: true });
    fetch.mockResolvedValue(answer('x'.repeat(1000)));
    const noticed = await getOpenRouterResponse(env, 'p', [], 'x');
    expect(noticed.text.length).toBe(950);
    expect(noticed.text.endsWith('...')).toBe(true);
    fetch.mockResolvedValue(response({ choices: [] }));
    await expect(getOpenRouterResponse(env, 'p', [], 'x')).rejects.toThrow('No choices');
  });
  it('continues when usage recording fails', async () => {
    fetch.mockResolvedValue(answer());
    recordTokenUsage.mockRejectedValue(new Error('D1 down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getOpenRouterResponse(env, 'p', [], 'x')).resolves.toMatchObject({ text: 'reply' });
    expect(error).toHaveBeenCalled();
  });
  it('reports request timeouts', async () => {
    vi.useFakeTimers();
    getEffectiveConfig.mockResolvedValue({ model: 'primary', fallbackModel: 'block', isOverLimit: false });
    fetch.mockImplementation((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = getOpenRouterResponse(env, 'p', [], 'x');
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});

describe('title and memory extraction', () => {
  it('generates bounded, unquoted titles and handles empty content', async () => {
    fetch.mockResolvedValue(answer('"  A Useful Title  "'));
    await expect(generateConversationTitle(env, 'name', [])).resolves.toBeNull();
    await expect(generateConversationTitle(env, 'name', [{ role: 'user', content: 'x' }])).resolves.toBe('A Useful Title');
    fetch.mockResolvedValue(answer('x'.repeat(70)));
    expect((await generateConversationTitle(env, 'name', [{ role: 'user', content: 'x' }])).length).toBe(60);
    fetch.mockResolvedValue(response({ choices: [{ message: { content: ' ' } }] }));
    await expect(generateConversationTitle(env, 'name', [{ role: 'user', content: 'x' }])).resolves.toBeNull();
    fetch.mockResolvedValue(answer());
    const history = Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: `${i}` }));
    await generateConversationTitle(env, 'name', history);
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body).messages).toHaveLength(7);
  });
  it('extracts and normalizes durable facts', async () => {
    await expect(extractMemory(env, 'm', [], null)).resolves.toBeNull();
    fetch.mockResolvedValue(response({ choices: [{ message: { content: '```json\n[" Likes tea ", 5, "", "' + 'x'.repeat(250) + '"]\n```' } }] }));
    const facts = await extractMemory(env, 'm', [{ role: 'user', content: 'hi' }], ['old']);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toBe('Likes tea');
    expect(facts[1]).toHaveLength(200);
    fetch.mockResolvedValue(response({ choices: [{ message: { content: '{}' } }] }));
    await expect(extractMemory(env, 'm', [{ role: 'user', content: 'x' }], null)).resolves.toBeNull();
    fetch.mockResolvedValue(response({ choices: [{ message: { content: 'nope' } }] }));
    await expect(extractMemory(env, 'm', [{ role: 'user', content: 'x' }], null)).resolves.toBeNull();
    fetch.mockRejectedValue(new Error('offline'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(extractMemory(env, 'm', [{ role: 'user', content: 'x' }], null)).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
