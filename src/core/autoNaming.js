// core/autoNaming.js - Auto-generates conversation titles after enough messages accumulate.
// Dispatched via ctx.waitUntil so it never blocks or delays the reply path.
// Best-effort: any failure is logged and swallowed, never surfaced to the user.
//
// phoneNumber + env.ENCRYPTION_KEY are required to decrypt history before passing
// to the naming model — without decryption the AI would receive ciphertext and
// produce garbage titles.

import { generateConversationTitle } from '../openrouter.js';
import { getConversationHistory, getConversationMeta, markConversationNamed, getSetting } from '../db/index.js';

const DEFAULT_NAMING_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
const NAMING_MESSAGE_THRESHOLD = 4; // 2 user+assistant pairs

export async function maybeAutoNameConversation(env, conversationId, phoneNumber, messageCount) {
  try {
    if (messageCount < NAMING_MESSAGE_THRESHOLD) return;

    const db = env.DB;
    const meta = await getConversationMeta(db, conversationId);
    if (!meta || meta.is_named) return;

    const fullHistory = await getConversationHistory(db, conversationId, phoneNumber, env.ENCRYPTION_KEY);
    if (fullHistory.length < NAMING_MESSAGE_THRESHOLD) return;

    const namingModel = await getSetting(db, 'naming_model', DEFAULT_NAMING_MODEL);
    const title = await generateConversationTitle(env, namingModel, fullHistory);
    if (!title) return;

    await markConversationNamed(db, conversationId, title);
  } catch (err) {
    console.error('Auto-naming error:', err.message);
  }
}
