import { describe, expect, it } from 'vitest';
import { getEffectiveConfig, recordTokenUsage, setNumberFallback, setNumberModel, setNumberTokenLimit } from '../../src/db/numbers.js';
import { makeDb } from '../helpers/fakeDb.js';

describe('number settings', () => {
  it('applies globals and per-number overrides', async () => {
    const db = makeDb([
      { match: 'FROM number_settings', first: null },
      { match: 'SELECT value', first: [{ value: 'global-model' }, { value: 'global-fallback' }, { value: '100' }] },
    ]);
    await expect(getEffectiveConfig(db, 'p')).resolves.toMatchObject({ model: 'global-model', fallbackModel: 'global-fallback', tokenLimit: 100, tokensUsed: 0, isOverLimit: false });
    const override = makeDb([
      { match: 'FROM number_settings', first: { model: 'local', fallback_model: 'local-fallback', token_limit: 7, tokens_input_used: 3, tokens_output_used: 4 } },
      { match: 'SELECT value', first: [{ value: 'global' }, { value: 'fallback' }, { value: '100' }] },
    ]);
    await expect(getEffectiveConfig(override, 'p')).resolves.toMatchObject({ model: 'local', fallbackModel: 'local-fallback', tokenLimit: 7, tokensUsed: 7, isOverLimit: true });
  });
  it('treats per-number zero and global blank/null as unlimited', async () => {
    for (const global of ['', null]) {
      const db = makeDb([
        { match: 'FROM number_settings', first: { token_limit: 0 } },
        { match: 'SELECT value', first: [{ value: 'm' }, { value: 'f' }, { value: global }] },
      ]);
      expect((await getEffectiveConfig(db, 'p')).tokenLimit).toBeNull();
    }
  });
  it('falls through nullable overrides and uses missing usage as zero', async () => {
    const db = makeDb([
      { match: 'FROM number_settings', first: { model: null, fallback_model: null, token_limit: null, tokens_input_used: undefined, tokens_output_used: null } },
      { match: 'SELECT value', first: [{ value: 'm' }, { value: 'f' }, { value: '10' }] },
    ]);
    expect(await getEffectiveConfig(db, 'p')).toMatchObject({ model: 'm', fallbackModel: 'f', tokenLimit: 10, tokensUsed: 0 });
  });
  it('records usage and maps setters', async () => {
    const db = makeDb([{ match: 'number_settings' }]);
    await recordTokenUsage(db, 'p', null, undefined);
    await setNumberModel(db, 'p', '');
    await setNumberFallback(db, 'p', '');
    await setNumberTokenLimit(db, 'p', undefined);
    await setNumberTokenLimit(db, 'p', 0);
    expect(db.calls.map(c => c.args)).toEqual([['p', 0, 0], ['p', null], ['p', null], ['p', null], ['p', 0]]);
  });
});
