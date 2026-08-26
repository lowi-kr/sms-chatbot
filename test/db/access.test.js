import { describe, expect, it } from 'vitest';
import { addToBlacklist, addToWhitelist, hasWhitelistEntries, isBlacklisted, isWhitelisted, removeFromBlacklist, removeFromWhitelist } from '../../src/db/access.js';
import { makeDb } from '../helpers/fakeDb.js';

describe('db access', () => {
  it('checks blacklist and whitelist truthiness', async () => {
    const db = makeDb([{ match: 'FROM blacklist', first: { id: 1 } }, { match: 'FROM whitelist', first: null }]);
    expect(await isBlacklisted(db, 'a')).toBe(true);
    expect(await isWhitelisted(db, 'a')).toBe(false);
  });
  it.each([0, 1])('checks whitelist count boundary %d', async count => {
    const db = makeDb([{ match: 'COUNT(*)', first: { count } }]);
    expect(await hasWhitelistEntries(db)).toBe(count > 0);
  });
  it('binds writes and defaults', async () => {
    const db = makeDb([
      { match: 'INSERT OR IGNORE INTO whitelist' },
      { match: 'INSERT OR IGNORE INTO blacklist' },
      { match: 'DELETE FROM whitelist' },
      { match: 'DELETE FROM blacklist' },
    ]);
    await addToWhitelist(db, 'w');
    await addToBlacklist(db, 'b');
    await removeFromWhitelist(db, 'w');
    await removeFromBlacklist(db, 'b');
    expect(db.calls.map(c => c.args)).toEqual([['w', ''], ['b', ''], ['w'], ['b']]);
  });
});
