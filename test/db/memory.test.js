import { describe, expect, it } from 'vitest';
import { deleteMemory, getMemoryMeta, getMemoryRow, saveMemoryRow, setMemoryIncognitoFlag } from '../../src/db/memory.js';
import { makeDb } from '../helpers/fakeDb.js';

describe('db memory', () => {
  it('returns null or the row', async () => {
    const db = makeDb([{ match: 'FROM memory', first: null }]);
    expect(await getMemoryRow(db, 'p')).toBeNull();
    const row = { phone_number: 'p' };
    const db2 = makeDb([{ match: 'FROM memory', first: row }]);
    expect(await getMemoryRow(db2, 'p')).toBe(row);
  });
  it('binds save and incognito values', async () => {
    const db = makeDb([{ match: 'INSERT INTO memory' }]);
    await saveMemoryRow(db, 'p', 'blob', 4);
    await setMemoryIncognitoFlag(db, 'p', true, 'empty');
    await setMemoryIncognitoFlag(db, 'p', false, 'empty');
    expect(db.calls[0].args).toEqual(['p', 'blob', 4]);
    expect(db.calls[1].args).toEqual(['p', 'empty', 1]);
    expect(db.calls[2].args).toEqual(['p', 'empty', 0]);
  });
  it('selects metadata without encrypted facts', async () => {
    const db = makeDb([{ match: 'last_extracted_message_count', first: { incognito: 0 } }]);
    await getMemoryMeta(db, 'p');
    expect(db.calls[0].sql).not.toMatch(/encrypted_facts/);
  });
  it('deletes memory', async () => {
    const db = makeDb([{ match: 'DELETE FROM memory' }]);
    await deleteMemory(db, 'p');
    expect(db.calls[0].args).toEqual(['p']);
  });
});
