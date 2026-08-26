import { describe, expect, it } from 'vitest';
import { getSetting, setSetting } from '../../src/db/settings.js';
import { makeDb } from '../helpers/fakeDb.js';

describe('db settings', () => {
  it('returns defaults only when no row exists', async () => {
    const db = makeDb([{ match: 'SELECT value', first: null }]);
    expect(await getSetting(db, 'x', 'default')).toBe('default');
  });
  it('preserves an empty-string stored value', async () => {
    const db = makeDb([{ match: 'SELECT value', first: { value: '' } }]);
    expect(await getSetting(db, 'x', 'default')).toBe('');
  });
  it('upserts key and value', async () => {
    const db = makeDb([{ match: 'INSERT INTO settings' }]);
    await setSetting(db, 'theme', 'dark');
    expect(db.calls[0].args).toEqual(['theme', 'dark']);
  });
});
