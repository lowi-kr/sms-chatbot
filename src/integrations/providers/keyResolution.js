// integrations/providers/keyResolution.js - Resolves which BYOK key (if any)
// should handle a given model, following the cascade described in the
// feature-byok proposal:
//
//   model requested → scoped admin key(s) for that exact model
//     → try prioritized tier in sort_order → try backup tier
//     → if always_use=false on the best candidate, caller falls back to
//       OpenRouter's default model
//     → if always_use=true, caller must hard-fail with a user-facing notice
//       instead of silently falling back (mirrors the existing
//       fallbackModel === 'block' sentinel in getEffectiveConfig())
//
// SIMPLIFICATION (v1, documented — revisit if this doesn't cover real usage):
// resolution is driven entirely by exact model-string scoping. An admin key
// with NO scope rows (i.e. "unrestricted") is only ever picked up as a
// last-resort catch-all, and only when it is the SOLE active unrestricted key
// in the whole table — with more than one unrestricted key we have no signal
// for which provider's models a given request is even trying to reach, so we
// deliberately do nothing rather than guess. Scope a key to specific models
// to make it reliably selected.
//
// This module never decrypts a key itself — it calls into
// db/providerKeys.js's getDecryptedKeyForUse() for that, keeping the actual
// decrypt call in exactly one place.

import { getDecryptedKeyForUse } from '../../db/providerKeys.js';
import { getProvider } from '../../db/providers.js';

// Returns:
//   { outcome: 'use-key', provider, apiKey, keyId, alwaysUse }
//   { outcome: 'no-key' }                              — caller should use OpenRouter default
//   { outcome: 'hard-fail', keyId }                     — always_use key matched but couldn't be used
async function resolveScopedCandidates(db, modelId) {
  const { results } = await db.prepare(`
    SELECT k.id, k.provider_id, k.priority_tier, k.sort_order, k.always_use
    FROM admin_provider_keys k
    JOIN provider_key_model_scope s ON s.provider_key_id = k.id
    WHERE k.is_active = 1 AND s.model_id = ?
    ORDER BY CASE k.priority_tier WHEN 'prioritized' THEN 0 ELSE 1 END, k.sort_order ASC
  `).bind(modelId).all();
  return results || [];
}

async function resolveSoleUnrestrictedKey(db) {
  const { results } = await db.prepare(`
    SELECT k.id, k.provider_id, k.priority_tier, k.sort_order, k.always_use
    FROM admin_provider_keys k
    WHERE k.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM provider_key_model_scope s WHERE s.provider_key_id = k.id)
    ORDER BY CASE k.priority_tier WHEN 'prioritized' THEN 0 ELSE 1 END, k.sort_order ASC
  `).all();
  return (results || []).length === 1 ? results[0] : null;
}

export async function resolveKeyForModel(db, encryptionKey, modelId) {
  let candidates = await resolveScopedCandidates(db, modelId);

  if (!candidates.length) {
    const sole = await resolveSoleUnrestrictedKey(db);
    candidates = sole ? [sole] : [];
  }

  if (!candidates.length) return { outcome: 'no-key' };

  // Try candidates in cascade order (prioritized tier first, then backup).
  // A candidate is only "used" if we can both decrypt it AND find its
  // provider row — either failure moves to the next candidate rather than
  // aborting the whole resolution, since a single bad/rotated key shouldn't
  // take down every other configured key.
  for (const candidate of candidates) {
    const provider = await getProvider(db, candidate.provider_id);
    if (!provider) {
      console.error(`Provider key id=${candidate.id} references unknown provider_id=${candidate.provider_id} — skipping`);
      continue;
    }

    const apiKey = await getDecryptedKeyForUse(db, encryptionKey, candidate.id);
    if (!apiKey) {
      // getDecryptedKeyForUse already logged the specific decryption failure.
      continue;
    }

    return {
      outcome: 'use-key',
      provider,
      apiKey,
      keyId: candidate.id,
      alwaysUse: !!candidate.always_use,
    };
  }

  // Every candidate failed to resolve. If ANY of them was always_use=true,
  // that's a hard-fail per the always_use contract (the admin explicitly said
  // "never fall back to OpenRouter for this model") — surface it rather than
  // silently using a default the admin didn't want.
  const anyAlwaysUse = candidates.some(c => c.always_use);
  if (anyAlwaysUse) {
    return { outcome: 'hard-fail', keyId: candidates[0].id };
  }

  return { outcome: 'no-key' };
}
