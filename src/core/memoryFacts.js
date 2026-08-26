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

// Returns an array of facts, or [] when the row is empty/undecryptable/not JSON.
// Never throws — a memory problem must never break the reply path.
export async function decryptFacts(phoneNumber, encryptedFacts, encryptionKey) {
  if (!encryptedFacts) return [];

  const decrypted = await decryptMessage(phoneNumber, encryptedFacts, encryptionKey, 'memory');
  if (!decrypted) return [];

  try {
    const parsed = JSON.parse(decrypted);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error(`Stored memory for ${phoneNumber} is not valid JSON — treating it as empty`);
    return [];
  }
}

export function encryptFacts(phoneNumber, facts, encryptionKey) {
  return encryptMessage(phoneNumber, JSON.stringify(facts), encryptionKey, 'memory');
}
