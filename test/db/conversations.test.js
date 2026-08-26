import { describe, expect, it, vi } from 'vitest';
import { getConversationHistory, getConversationMeta, getOrCreateActiveConversation, markConversationNamed, saveMessage } from '../../src/db/conversations.js';
import { makeDb } from '../helpers/fakeDb.js';
import { makeEnv } from '../helpers/env.js';

const key = makeEnv().ENCRYPTION_KEY;

describe('db conversations', () => {
  it('returns an existing conversation or inserts a new one', async () => {
    const existing = { id: 2, name: 'Existing' };
    expect(await getOrCreateActiveConversation(makeDb([{ match: 'SELECT id, name', first: existing }]), 'p')).toBe(existing);
    const db = makeDb([{ match: 'SELECT id, name', first: null }, { match: 'INSERT INTO conversations', run: { meta: { last_row_id: 9 } } }]);
    expect((await getOrCreateActiveConversation(db, 'p')).id).toBe(9);
    expect(db.calls[1].args[0]).toBe('p');
  });
  it('encrypts message content and bumps updated_at', async () => {
    const db = makeDb([{ match: 'INSERT INTO messages' }, { match: 'UPDATE conversations' }]);
    await saveMessage(db, 3, 'user', 'private', 'p', key);
    expect(db.calls[0].args[2]).not.toBe('private');
    const { decryptMessage } = await import('../../src/security/crypto.js');
    expect(await decryptMessage('p', db.calls[0].args[2], key)).toBe('private');
    expect(db.calls[1].args).toEqual([3]);
  });
  it('decrypts history in order and substitutes failed rows', async () => {
    const { encryptMessage } = await import('../../src/security/crypto.js');
    const good = await encryptMessage('p', 'hello', key);
    const db = makeDb([{ match: 'SELECT role, content', all: [{ role: 'user', content: good }, { role: 'assistant', content: 'bad' }] }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getConversationHistory(db, 1, 'p', key)).resolves.toEqual([
      { role: 'user', content: 'hello' }, { role: 'assistant', content: '[message unavailable]' },
    ]);
    error.mockRestore();
    const empty = makeDb([{ match: 'SELECT role, content', all: [] }]);
    await expect(getConversationHistory(empty, 1, 'p', key)).resolves.toEqual([]);
  });
  it('reads metadata and marks named', async () => {
    const db = makeDb([{ match: 'SELECT id, name, is_named', first: { id: 1 } }, { match: 'UPDATE conversations' }]);
    expect(await getConversationMeta(db, 1)).toEqual({ id: 1 });
    await markConversationNamed(db, 1, 'Title');
    expect(db.calls[1].args).toEqual(['Title', 1]);
  });
});
