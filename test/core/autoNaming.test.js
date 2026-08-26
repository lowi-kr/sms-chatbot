import { beforeEach, describe, expect, it, vi } from 'vitest';
const generateConversationTitle = vi.hoisted(() => vi.fn());
vi.mock('../../src/integrations/providers/openrouter.js', () => ({ generateConversationTitle }));
const getConversationHistory = vi.hoisted(() => vi.fn());
const getConversationMeta = vi.hoisted(() => vi.fn());
const markConversationNamed = vi.hoisted(() => vi.fn());
const getSetting = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/index.js', () => ({ getConversationHistory, getConversationMeta, markConversationNamed, getSetting }));
import { maybeAutoNameConversation } from '../../src/core/autoNaming.js';
import { makeEnv } from '../helpers/env.js';

beforeEach(() => {
  vi.clearAllMocks();
  getConversationMeta.mockResolvedValue({ is_named: 0 });
  getConversationHistory.mockResolvedValue(Array.from({ length: 4 }, () => ({ role: 'user', content: 'x' })));
  getSetting.mockResolvedValue('naming-model');
  generateConversationTitle.mockResolvedValue('A title');
});
describe('maybeAutoNameConversation', () => {
  it('does nothing below thresholds, when named/missing, or short history', async () => {
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 3);
    expect(getConversationMeta).not.toHaveBeenCalled();
    getConversationMeta.mockResolvedValue({ is_named: 1 });
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 4);
    getConversationMeta.mockResolvedValue(null);
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 4);
    getConversationMeta.mockResolvedValue({ is_named: 0 });
    getConversationHistory.mockResolvedValue([]);
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 4);
    expect(generateConversationTitle).not.toHaveBeenCalled();
  });
  it('marks a generated title, skips null title, and swallows errors', async () => {
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 4);
    expect(markConversationNamed).toHaveBeenCalledWith(expect.anything(), 1, 'A title');
    generateConversationTitle.mockResolvedValue(null);
    markConversationNamed.mockClear();
    await maybeAutoNameConversation(makeEnv(), 1, '+1', 4);
    expect(markConversationNamed).not.toHaveBeenCalled();
    getConversationMeta.mockRejectedValue(new Error('bad'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(maybeAutoNameConversation(makeEnv(), 1, '+1', 4)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});
