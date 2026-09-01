// admin/providerKeys.js - Admin-facing CRUD for BYOK provider API keys.
//
// PRIVACY BOUNDARY (narrow, explicit exception): every other file under
// src/admin/ must never touch env.ENCRYPTION_KEY, because the encrypted data
// they're adjacent to (conversation messages, memory facts) is something the
// admin must NEVER be able to read back out — that's the whole point of the
// encryption. Provider API keys are a different kind of secret: the admin is
// the one who OWNS these keys and typed them in themselves. There is nothing
// to protect the admin from here — the boundary that matters for BYOK keys is
// "never send the plaintext key back down to the browser after it's saved",
// not "the admin must never be able to touch ENCRYPTION_KEY".
//
// So: this file DOES use env.ENCRYPTION_KEY, but only ever calls
// encryptAndStoreKey() (write/encrypt path). It NEVER calls
// getDecryptedKeyForUse() — that function only exists for
// src/integrations/providers/keyResolution.js to call at the moment of an
// actual outbound API call. If you're editing this file and find yourself
// wanting to decrypt a key to show or verify it, stop — that's exactly the
// mistake this comment exists to prevent. Every GET/list route here works
// with metadata only (id, label, masked last4, tiers, flags).

import { json, dbTry, readJsonBody } from './helpers.js';
import { getAllProviders, getProvider } from '../db/providers.js';
import {
  encryptAndStoreKey, listKeys, deleteKey, setKeyActive, updateKeyOrder,
  setKeyModelScope, getKeyModelScope,
} from '../db/providerKeys.js';

export async function handleProviderKeys(request, env, path) {
  const db = env.DB;

  // ---- Provider registry (read-only, no keys involved) ----

  if (path === '/api/providers' && request.method === 'GET') {
    return dbTry(async () => json(await getAllProviders(db)));
  }

  // ---- List keys (metadata only — no decryption anywhere in this path) ----

  if (path === '/api/provider-keys' && request.method === 'GET') {
    return dbTry(async () => {
      const url = new URL(request.url);
      const providerId = url.searchParams.get('provider_id') || null;
      const keys = await listKeys(db, providerId);
      // Attach model scope for each key so the dashboard doesn't need N+1 requests.
      const withScope = await Promise.all(keys.map(async (k) => ({
        ...k,
        model_scope: await getKeyModelScope(db, k.id),
      })));
      return json(withScope);
    });
  }

  // ---- Add a new key (the one legitimate encrypt-on-write path) ----

  if (path === '/api/provider-keys' && request.method === 'POST') {
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    const { provider_id, label, api_key, priority_tier, sort_order, always_use, model_scope } = body;

    if (!provider_id || !api_key) {
      return json({ error: 'Missing provider_id or api_key' }, 400);
    }
    if (typeof api_key !== 'string' || api_key.trim().length < 8) {
      return json({ error: 'api_key looks too short to be valid — check for a copy/paste error' }, 400);
    }
    if (priority_tier && !['prioritized', 'backup'].includes(priority_tier)) {
      return json({ error: 'priority_tier must be "prioritized" or "backup"' }, 400);
    }
    if (!env.ENCRYPTION_KEY) {
      // Fail loudly and immediately rather than silently storing something
      // unencrypted-adjacent or half-written — see encryptAndStoreKey's own
      // validateEncryptionKeyHex() for the detailed error if this check is
      // ever bypassed.
      return json({ error: 'ENCRYPTION_KEY is not configured on this worker — cannot store provider keys safely' }, 500);
    }

    return dbTry(async () => {
      const provider = await getProvider(db, provider_id);
      if (!provider) return json({ error: `Unknown provider_id: ${provider_id}` }, 400);

      const stored = await encryptAndStoreKey(db, env.ENCRYPTION_KEY, {
        providerId: provider_id,
        label: label || null,
        plaintextApiKey: api_key.trim(),
        priorityTier: priority_tier || 'prioritized',
        sortOrder: Number.isFinite(sort_order) ? sort_order : 0,
        alwaysUse: !!always_use,
      });

      if (Array.isArray(model_scope) && model_scope.length) {
        await setKeyModelScope(db, stored.id, model_scope);
      }

      // Deliberately does NOT echo api_key back, even truncated beyond last4 —
      // the dashboard already has last4 from `stored`.
      return json({ success: true, key: stored });
    });
  }

  // ---- Update tier/order/always_use for an existing key ----

  const orderMatch = path.match(/^\/api\/provider-keys\/(\d+)\/order$/);
  if (orderMatch && request.method === 'POST') {
    const keyId = parseInt(orderMatch[1], 10);
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    const priorityTier = body.priority_tier;
    const sortOrder = Number.isFinite(body.sort_order) ? body.sort_order : 0;
    const alwaysUse = !!body.always_use;

    if (priorityTier && !['prioritized', 'backup'].includes(priorityTier)) {
      return json({ error: 'priority_tier must be "prioritized" or "backup"' }, 400);
    }

    return dbTry(async () => {
      await updateKeyOrder(db, keyId, {
        priorityTier: priorityTier || 'prioritized',
        sortOrder,
        alwaysUse,
      });
      return json({ success: true });
    });
  }

  // ---- Enable/disable a key without deleting it ----

  const activeMatch = path.match(/^\/api\/provider-keys\/(\d+)\/active$/);
  if (activeMatch && request.method === 'POST') {
    const keyId = parseInt(activeMatch[1], 10);
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    return dbTry(async () => {
      await setKeyActive(db, keyId, !!body.is_active);
      return json({ success: true });
    });
  }

  // ---- Replace a key's model scope ----

  const scopeMatch = path.match(/^\/api\/provider-keys\/(\d+)\/scope$/);
  if (scopeMatch && request.method === 'POST') {
    const keyId = parseInt(scopeMatch[1], 10);
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    const modelIds = Array.isArray(body.model_ids) ? body.model_ids.filter(m => typeof m === 'string' && m.trim()) : [];

    return dbTry(async () => {
      await setKeyModelScope(db, keyId, modelIds);
      return json({ success: true, model_scope: modelIds });
    });
  }

  // ---- Delete a key ----

  const deleteMatch = path.match(/^\/api\/provider-keys\/(\d+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    const keyId = parseInt(deleteMatch[1], 10);
    return dbTry(async () => {
      await deleteKey(db, keyId);
      return json({ success: true });
    });
  }

  return null;
}
