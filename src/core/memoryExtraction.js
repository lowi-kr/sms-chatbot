// core/memoryExtraction.js - Extracts durable per-number facts from conversation
// history and stores them encrypted, once enough new messages have accumulated.
// Dispatched via ctx.waitUntil so it never blocks or delays the reply path.
// Best-effort: any failure is logged and swallowed, never surfaced to the user.
// Mirrors the structure of core/autoNaming.js.
//
// phoneNumber + env.ENCRYPTION_KEY are required both to decrypt existing memory/
// history and to encrypt the newly extracted facts — without ENCRYPTION_KEY this
// entire module is a no-op, same as messages would be unreadable without it.
//
// If incognito mode is on for this number (set via /memory incognito on), extraction
// is skipped entirely — no history read for this purpose, no memory row write, and
// the extraction counter (last_extracted_message_count) is not advanced.
//
// Re-summarizes the FULL conversation history each time (merging with any existing
// facts via the extraction prompt) rather than only the new tail. Simpler and
// self-correcting; costs a bit more tokens per extraction but the naming/memory
// models are cheap/free and this only fires every N messages.

import { extractMemory } from '../integrations/providers/openrouter.js';
import { encryptMessage, decryptMessage } from '../security/crypto.js';
import { getConversationHistory, getMemoryRow, saveMemoryRow, getSetting } from '../db/index.js';

const DEFAULT_MEMORY_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const DEFAULT_MEMORY_THRESHOLD = 10; // extract once this many new messages accumulate

export async function maybeExtractMemory(env, conversationId, phoneNumber) {
  try {
    if (!env.ENCRYPTION_KEY) return; // no pepper configured — nothing to encrypt with, skip entirely

    const db = env.DB;
    const memRow = await getMemoryRow(db, phoneNumber);
    if (memRow?.incognito) return; // user has paused memory — respect it, do nothing

    const fullHistory = await getConversationHistory(db, conversationId, phoneNumber, env.ENCRYPTION_KEY);
    const lastCount = memRow?.last_extracted_message_count || 0;

    const thresholdRaw = await getSetting(db, 'memory_extraction_threshold', String(DEFAULT_MEMORY_THRESHOLD));
    const threshold = parseInt(thresholdRaw, 10) || DEFAULT_MEMORY_THRESHOLD;

    if (fullHistory.length - lastCount < threshold) return;

    let existingFacts = null;
    if (memRow?.encrypted_facts) {
      const decrypted = await decryptMessage(phoneNumber, memRow.encrypted_facts, env.ENCRYPTION_KEY, 'memory');
      if (decrypted) existingFacts = JSON.parse(decrypted);
    }

    const memoryModel = await getSetting(db, 'memory_model', DEFAULT_MEMORY_MODEL);
    const newFacts = await extractMemory(env, memoryModel, fullHistory, existingFacts);
    if (newFacts === null) return; // extraction failed — don't overwrite existing memory or bump the counter

    const encrypted = await encryptMessage(phoneNumber, JSON.stringify(newFacts), env.ENCRYPTION_KEY, 'memory');
    await saveMemoryRow(db, phoneNumber, encrypted, fullHistory.length);
  } catch (err) {
    console.error('Memory extraction error:', err.message);
  }
}
