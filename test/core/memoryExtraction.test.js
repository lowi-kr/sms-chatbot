import { beforeEach, describe, expect, it, vi } from 'vitest';
const extractMemory = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/providers/openrouter.js', () => ({ extractMemory }));
const getConversationHistory = vi.hoisted(() => vi.fn());
const getMemoryRow = vi.hoisted(() => vi.fn());
const saveMemoryRow = vi.hoisted(() => vi.fn());
const getSetting = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/index.js', () => ({ getConversationHistory, getMemoryRow, saveMemoryRow, getSetting }));
const encryptMessage = vi.hoisted(() => vi.fn().mockResolvedValue('encrypted'));
const decryptMessage = vi.hoisted(() => vi.fn());
vi.mock('../../src/security/crypto.js', () => ({ encryptMessage, decryptMessage }));
import { maybeExtractMemory } from '../../src/core/memoryExtraction.js';
import { makeEnv } from '../helpers/env.js';

beforeEach(() => {
  vi.clearAllMocks();
  getMemoryRow.mockResolvedValue(null);
  getConversationHistory.mockResolvedValue(Array.from({ length: 10 }, () => ({ role: 'user', content: 'x' })));
  getSetting.mockResolvedValue('10');
  extractMemory.mockResolvedValue(['fact']);
  decryptMessage.mockResolvedValue(JSON.stringify(['old']));
});
describe('maybeExtractMemory', () => {
  it('skips without key, in incognito, below threshold, and supports fallback threshold', async () => {
    await maybeExtractMemory(makeEnv({ ENCRYPTION_KEY: undefined }), 1, '+1');
    expect(getMemoryRow).not.toHaveBeenCalled();
    getMemoryRow.mockResolvedValue({ incognito: 1 });
    await maybeExtractMemory(makeEnv(), 1, '+1');
    expect(getConversationHistory).not.toHaveBeenCalled();
    getMemoryRow.mockResolvedValue({ last_extracted_message_count: 9 });
    await maybeExtractMemory(makeEnv(), 1, '+1');
    expect(extractMemory).not.toHaveBeenCalled();
    getMemoryRow.mockResolvedValue({ last_extracted_message_count: 0 });
    getSetting.mockResolvedValueOnce('nonsense');
    await maybeExtractMemory(makeEnv(), 1, '+1');
    expect(extractMemory).toHaveBeenCalled();
  });
  it('passes existing facts, does not advance on null, and saves encrypted results', async () => {
    getMemoryRow.mockResolvedValue({ encrypted_facts: 'oldblob', last_extracted_message_count: 0 });
    extractMemory.mockResolvedValueOnce(null);
    await maybeExtractMemory(makeEnv(), 1, '+1');
    expect(saveMemoryRow).not.toHaveBeenCalled();
    extractMemory.mockResolvedValue(['new']);
    const env = makeEnv();
    await maybeExtractMemory(env, 1, '+1');
    expect(extractMemory).toHaveBeenCalledWith(env, '10', expect.any(Array), ['old']);
    expect(saveMemoryRow).toHaveBeenCalledWith(expect.anything(), '+1', 'encrypted', 10);
  });
  it('swallows extraction errors', async () => {
    getConversationHistory.mockRejectedValue(new Error('bad history'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(maybeExtractMemory(makeEnv(), 1, '+1')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
