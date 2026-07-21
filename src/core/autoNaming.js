// core/autoNaming.js - Auto-generates conversation titles after enough messages accumulate.
// Dispatched via ctx.waitUntil so it never blocks or delays the reply path.
// Best-effort: any failure is logged and swallowed, never surfaced to the user.

import { generateConversationTitle } from '../openrouter.js';
import { getConversationHistory, getConversationMeta, markConversationNamed } from '../db/index.js';
import { getSetting } from '../db/index.js';

const DEFAULT_NAMING_MODEL = 'openrouter/free';
const NAMING_MESSAGE_THRESHOLD = 4; // 2 user+assistant pairs

export async function maybeAutoNameConversation(env, conversationId, messageCount) {
  try {
    if (messageCount < NAMING_MESSAGE_THRESHOLD) return;

    const db = env.DB;
    const meta = await getConversationMeta(db, conversationId);
    if (!meta || meta.is_named) return;

    const fullHistory = await getConversationHistory(db, conversationId);
    if (fullHistory.length < NAMING_MESSAGE_THRESHOLD) return;

    const namingModel = await getSetting(db, 'naming_model', DEFAULT_NAMING_MODEL);
    const title = await generateConversationTitle(env, namingModel, fullHistory);
    if (!title) return;

    await markConversationNamed(db, conversationId, title);
  } catch (err) {
    console.error('Auto-naming error:', err.message);
  }
}
