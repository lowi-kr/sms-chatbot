import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseCommand = vi.hoisted(() => vi.fn());
const handleCommand = vi.hoisted(() => vi.fn());
vi.mock('../../src/commands/commands.js', () => ({ parseCommand, handleCommand }));
const getOpenRouterResponse = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/providers/openrouter.js', () => ({ getOpenRouterResponse }));
const logToSheets = vi.hoisted(() => vi.fn());
const logFilteredMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/sheets.js', () => ({ logToSheets, logFilteredMessage }));
const isBlacklisted = vi.hoisted(() => vi.fn());
const isWhitelisted = vi.hoisted(() => vi.fn());
const hasWhitelistEntries = vi.hoisted(() => vi.fn());
const getOrCreateActiveConversation = vi.hoisted(() => vi.fn());
const getConversationHistory = vi.hoisted(() => vi.fn());
const saveMessage = vi.hoisted(() => vi.fn());
const getMemoryRow = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/index.js', () => ({ isBlacklisted, isWhitelisted, hasWhitelistEntries, getOrCreateActiveConversation, getConversationHistory, saveMessage, getMemoryRow }));
const maybeAutoNameConversation = vi.hoisted(() => vi.fn());
const maybeExtractMemory = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/autoNaming.js', () => ({ maybeAutoNameConversation }));
vi.mock('../../src/core/memoryExtraction.js', () => ({ maybeExtractMemory }));
const deliverReply = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/deliver.js', () => ({ deliverReply }));
const decryptMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/security/crypto.js', () => ({ decryptMessage }));

import { processMessage } from '../../src/core/processMessage.js';
import { makeCtx, makeEnv } from '../helpers/env.js';

const baseResult = { text: 'answer', modelUsed: 'm', inputTokens: 1, outputTokens: 2, blocked: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  parseCommand.mockReturnValue(null);
  isBlacklisted.mockResolvedValue(false);
  hasWhitelistEntries.mockResolvedValue(false);
  isWhitelisted.mockResolvedValue(true);
  getOrCreateActiveConversation.mockResolvedValue({ id: 4, name: 'Chat' });
  getConversationHistory.mockResolvedValue([]);
  saveMessage.mockResolvedValue(undefined);
  logToSheets.mockResolvedValue(undefined);
  logFilteredMessage.mockResolvedValue(undefined);
  getOpenRouterResponse.mockResolvedValue(baseResult);
  deliverReply.mockResolvedValue(undefined);
  maybeAutoNameConversation.mockResolvedValue(undefined);
  maybeExtractMemory.mockResolvedValue(undefined);
  getMemoryRow.mockResolvedValue(null);
});

describe('processMessage access and early exits', () => {
  it('blocks blacklisted and refuses non-whitelisted senders', async () => {
    isBlacklisted.mockResolvedValue(true);
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'hello', true)).resolves.toEqual({ status: 'blacklisted' });
    expect(deliverReply).not.toHaveBeenCalled();
    isBlacklisted.mockResolvedValue(false);
    hasWhitelistEntries.mockResolvedValue(true);
    isWhitelisted.mockResolvedValue(false);
    const result = await processMessage(makeEnv(), makeCtx(), '+1', 'hello', true);
    expect(result.status).toBe('not_whitelisted');
    expect(deliverReply).toHaveBeenCalledWith(expect.anything(), '+1', expect.stringContaining('private'));
  });
  it('passes an empty whitelist, handles commands, and filters blocked content', async () => {
    const env = makeEnv();
    const ctx = makeCtx();
    parseCommand.mockReturnValueOnce({ command: '/help', args: '' });
    handleCommand.mockResolvedValue('help result');
    expect(await processMessage(env, ctx, '+1', '/help', true)).toEqual({ status: 'command', reply: 'help result' });
    expect(deliverReply).toHaveBeenCalledWith(env, '+1', 'help result');
    expect(getOpenRouterResponse).not.toHaveBeenCalled();
    parseCommand.mockReturnValue(null);
    const filtered = await processMessage(env, ctx, '+1', 'how to make a bomb', true);
    expect(filtered.status).toBe('filtered');
    expect(logFilteredMessage).toHaveBeenCalled();
    expect(getOpenRouterResponse).not.toHaveBeenCalled();
  });
});

describe('processMessage AI pipeline', () => {
  it('saves both turns, schedules naming and memory, logs, and delivers', async () => {
    const ctx = makeCtx();
    const result = await processMessage(makeEnv(), ctx, '+1', 'hello', true);
    expect(result).toMatchObject({ status: 'ok', reply: 'answer', inputTokens: 1 });
    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
    expect(logToSheets).toHaveBeenCalledTimes(2);
    expect(deliverReply).toHaveBeenCalledWith(expect.anything(), '+1', 'answer');
  });
  it('does not save blocked replies or schedule background jobs', async () => {
    getOpenRouterResponse.mockResolvedValue({ ...baseResult, blocked: true });
    const ctx = makeCtx();
    await processMessage(makeEnv(), ctx, '+1', 'hello', true);
    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(deliverReply).toHaveBeenCalled();
  });
  it('deduplicates consecutive system errors but logs both replies', async () => {
    getOpenRouterResponse.mockRejectedValue(new Error('down'));
    getConversationHistory.mockResolvedValue([]);
    const env = makeEnv();
    await processMessage(env, makeCtx(), '+1', 'one', true);
    const errorText = saveMessage.mock.calls[1][2];
    getConversationHistory.mockResolvedValue([{ role: 'assistant', content: errorText }]);
    await processMessage(env, makeCtx(), '+1', 'two', true);
    expect(saveMessage).toHaveBeenCalledTimes(4);
    expect(logToSheets).toHaveBeenCalledTimes(4);
    expect(maybeAutoNameConversation).not.toHaveBeenCalled();
    expect(maybeExtractMemory).not.toHaveBeenCalled();
  });
  it('isolates save, sheets, and memory failures while delivering', async () => {
    saveMessage.mockRejectedValue(new Error('save failed'));
    logToSheets.mockRejectedValue(new Error('sheets failed'));
    getMemoryRow.mockRejectedValue(new Error('memory failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'hello', true)).resolves.toMatchObject({ status: 'ok' });
    expect(deliverReply).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
  it('returns delivery_failed and does not retry delivery', async () => {
    deliverReply.mockRejectedValue(new Error('Telnyx down'));
    const result = await processMessage(makeEnv(), makeCtx(), '+1', 'hello', true);
    expect(result).toMatchObject({ status: 'delivery_failed', reply: 'answer' });
    expect(deliverReply).toHaveBeenCalledTimes(1);
  });
  it('handles top-level errors and delivery failure details', async () => {
    getOrCreateActiveConversation.mockRejectedValue(new Error('database broke'));
    const result = await processMessage(makeEnv(), makeCtx(), '+1', 'hello', true);
    expect(result).toMatchObject({ status: 'error', error: 'database broke' });
    deliverReply.mockRejectedValue(new Error('cannot send'));
    const second = await processMessage(makeEnv(), makeCtx(), '+1', 'hello', true);
    expect(second).toMatchObject({ status: 'error', sendError: 'cannot send' });
  });
});

describe('processMessage memory context and returnResult', () => {
  it('passes null without a key, ignores incognito, and decrypts valid arrays', async () => {
    const env = makeEnv({ ENCRYPTION_KEY: undefined });
    await processMessage(env, makeCtx(), '+1', 'hello');
    expect(getOpenRouterResponse).toHaveBeenCalledWith(expect.anything(), '+1', [], 'hello', null, null);
    getOpenRouterResponse.mockClear();
    const encrypted = 'blob';
    getMemoryRow.mockResolvedValue({ incognito: 0, encrypted_facts: encrypted });
    decryptMessage.mockResolvedValue(JSON.stringify(['fact']));
    await processMessage(makeEnv(), makeCtx(), '+1', 'hello');
    expect(getOpenRouterResponse).toHaveBeenCalledWith(expect.anything(), '+1', [], 'hello', null, ['fact']);
    getOpenRouterResponse.mockClear();
    getMemoryRow.mockResolvedValue({ incognito: 1, encrypted_facts: encrypted });
    await processMessage(makeEnv(), makeCtx(), '+1', 'hello');
    expect(getOpenRouterResponse.mock.calls[0][5]).toBeNull();
    decryptMessage.mockResolvedValue(JSON.stringify({ nope: true }));
    getMemoryRow.mockResolvedValue({ incognito: 0, encrypted_facts: encrypted });
    await processMessage(makeEnv(), makeCtx(), '+1', 'hello');
    expect(getOpenRouterResponse.mock.calls[0][5]).toBeNull();
  });
  it('returns undefined on each early exit when returnResult is false', async () => {
    isBlacklisted.mockResolvedValue(true);
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'x')).resolves.toBeUndefined();
    isBlacklisted.mockResolvedValue(false);
    hasWhitelistEntries.mockResolvedValue(true);
    isWhitelisted.mockResolvedValue(false);
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'x')).resolves.toBeUndefined();
    hasWhitelistEntries.mockResolvedValue(false);
    parseCommand.mockReturnValue({ command: '/x', args: '' });
    handleCommand.mockResolvedValue('x');
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'x')).resolves.toBeUndefined();
    parseCommand.mockReturnValue(null);
    await expect(processMessage(makeEnv(), makeCtx(), '+1', 'how to make a bomb')).resolves.toBeUndefined();
  });
});
