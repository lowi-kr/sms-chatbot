// core/memoryFacts.js - The single place that turns the encrypted `memory.encrypted_facts`
// blob into a fact array and back, plus the limits every writer must respect.
// Callers (commands.js, processMessage.js, memoryExtraction.js) supply
// ENCRYPTION_KEY; db/memory.js stays crypto-free and the admin API — which never
// holds the key — has no path through here to plaintext facts.

import { encryptMessage, decryptMessage } from '../security/crypto.js';

export const MAX_STORED_FACTS = 8;
export const MAX_FACT_LENGTH = 200;

// Trims, drops non-strings/blanks, caps each fact's length and keeps only the
// most recent MAX_STORED_FACTS.
export function normalizeFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts
    .filter(f => typeof f === 'string' && f.trim())
    .map(f => f.trim().slice(0, MAX_FACT_LENGTH))
    .slice(-MAX_STORED_FACTS);
}

// Returns { facts, corrupted }. `facts` is always an array (empty when there's
// nothing stored, decryption fails, or the stored value isn't a JSON array).
// `corrupted` is true ONLY when a blob was actually present but couldn't be
// turned back into facts — as opposed to there simply being no memory yet.
// This distinction matters to user-facing callers (commands.js's /memory):
// silently treating "corrupted" the same as "empty" would make a person's
// facts vanish with no explanation, and — worse — a naive "just start fresh"
// write path could then overwrite the corrupted blob with new data, destroying
// whatever was recoverable. Best-effort/background callers that don't need to
// tell a human anything (processMessage.js, memoryExtraction.js) can use the
// simpler decryptFacts() below instead.
export async function decryptFactsChecked(phoneNumber, encryptedFacts, encryptionKey) {
  if (!encryptedFacts) return { facts: [], corrupted: false };

  const decrypted = await decryptMessage(phoneNumber, encryptedFacts, encryptionKey, 'memory');
  if (!decrypted) return { facts: [], corrupted: true };

  try {
    const parsed = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) {
      console.error(`Stored memory for ${phoneNumber} is not a JSON array — treating as corrupted`);
      return { facts: [], corrupted: true };
    }
    return { facts: parsed, corrupted: false };
  } catch {
    console.error(`Stored memory for ${phoneNumber} is not valid JSON — treating as corrupted`);
    return { facts: [], corrupted: true };
  }
}

// Returns an array of facts, or [] when the row is empty/undecryptable/not JSON.
// Never throws — a memory problem must never break the reply path. Thin wrapper
// around decryptFactsChecked() for callers that only care about the facts, not
// whether something went wrong (see decryptFactsChecked's doc comment above).
export async function decryptFacts(phoneNumber, encryptedFacts, encryptionKey) {
  const { facts } = await decryptFactsChecked(phoneNumber, encryptedFacts, encryptionKey);
  return facts;
}

export function encryptFacts(phoneNumber, facts, encryptionKey) {
  return encryptMessage(phoneNumber, JSON.stringify(facts), encryptionKey, 'memory');
              }
