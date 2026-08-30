// core/processMessage.js - Main message processing pipeline
// Called by both the Telnyx webhook handler and the /test route.
// returnResult: when true, returns a summary object (used by /test endpoint)
// modelOverride: forces a specific model, skipping D1 resolution (used by test console picker)
//
// Error isolation contract:
//   - Access checks, command handling, and content filtering may abort early, but
//     their reply delivery is isolated so a delivery failure does not re-enter
//     the top-level error handler.
//   - Inside runAiTurn, each step (save, log, AI call, deliver) is isolated so one
//     failure never silently prevents the steps that follow from running.
//   - sheets.js has its own internal try/catch but we wrap it here too so a future
//     regression there can never take down the pipeline.
//   - Memory fetch/decrypt is isolated the same way: a failure there means the AI
//     call proceeds without memory context, it never blocks or fails the reply.
//
// System-error handling (systemError: true, set in callAi when the OpenRouter call
// itself throws): the fallback text is delivered to the user and logged to Sheets on
// every occurrence, same as any other reply. But it's only WRITTEN into the encrypted
// conversation history ONCE per outage streak — deduped by checking whether the
// immediately-preceding history entry is already that exact error text. This means:
//   - Retrying "hi" five times during an outage doesn't stuff five identical error
//     turns into history (which previously caused the model to notice the repetition
//     and comment on it once service recovered — "I keep getting stuck with the same
//     reply...").
//   - The FIRST error in a streak is still recorded once, so if the user later asks
//     "why were you down earlier?", the model has real, honest context to answer from
//     instead of denying anything happened.
//   - Auto-naming and memory extraction never trigger off a system-error turn either
//     way — those only fire from a genuine successful exchange.

import { parseCommand, handleCommand } from '../commands/commands.js';
import { containsBlockedContent } from '../security/filter.js';
import { decryptMessage } from '../security/crypto.js';
import { getOpenRouterResponse } from '../integrations/providers/openrouter.js';
import { logToSheets, logFilteredMessage } from '../integrations/sheets.js';
import {
  isBlacklisted, isWhitelisted, hasWhitelistEntries,
  getOrCreateActiveConversation, getConversationHistory, saveMessage,
  getMemoryRow,
} from '../db/index.js';
import { maybeAutoNameConversation } from './autoNaming.js';
import { maybeExtractMemory } from './memoryExtraction.js';
import { deliverReply } from './deliver.js';

export async function processMessage(env, ctx, phoneNumber, text, returnResult = false, modelOverride = null) {
  try {
    const db = env.DB;

    const accessResult = await checkAccess(env, db, phoneNumber);
    if (accessResult) return returnResult ? accessResult : undefined;

    const commandResult = await tryHandleCommand(env, db, phoneNumber, text);
    if (commandResult) return returnResult ? commandResult : undefined;

    if (containsBlockedContent(text)) {
      const filterResult = await handleFilteredMessage(env, phoneNumber, text);
      return returnResult ? filterResult : undefined;
    }

    return await runAiTurn(env, ctx, db, phoneNumber, text, returnResult, modelOverride);

  } catch (err) {
    console.error('Unhandled error in processMessage:', err);
    return await handlePipelineError(env, phoneNumber, err, returnResult);
  }
}

// --- Access control ---

async function checkAccess(env, db, phoneNumber) {
  if (await isBlacklisted(db, phoneNumber)) {
    console.log(`Blocked message from blacklisted number: ${phoneNumber}`);
    return { status: 'blacklisted' };
  }

  const whitelistActive = await hasWhitelistEntries(db);
  if (whitelistActive && !(await isWhitelisted(db, phoneNumber))) {
    const msg = "Sorry, this chatbot is private. You don't have access.";
    try {
      await deliverReply(env, phoneNumber, msg);
    } catch (err) {
      console.error('Failed to deliver access reply via Telnyx:', err.message);
      return { status: 'delivery_failed', error: err.message, reply: msg };
    }
    return { status: 'not_whitelisted', reply: msg };
  }

  return null;
}

// --- Slash commands ---

async function tryHandleCommand(env, db, phoneNumber, text) {
  const parsed = parseCommand(text);
  if (!parsed) return null;

  // env is passed through so memory commands (/memory, /forget-memory) can
  // reach ENCRYPTION_KEY to encrypt/decrypt facts.
  const response = await handleCommand(parsed.command, parsed.args, phoneNumber, db, env);
  try {
    await deliverReply(env, phoneNumber, response);
  } catch (err) {
    console.error('Failed to deliver command reply via Telnyx:', err.message);
    return { status: 'delivery_failed', error: err.message, reply: response };
  }
  return { status: 'command', reply: response };
}

// --- Content filter ---

async function handleFilteredMessage(env, phoneNumber, text) {
  // logFilteredMessage has its own internal try/catch and never throws
  await logFilteredMessage(env, { phoneNumber, message: text });
  const msg = "Sorry, I can't respond to that kind of message. Please keep our conversation appropriate.";
  try {
    await deliverReply(env, phoneNumber, msg);
  } catch (err) {
    console.error('Failed to deliver filtered reply via Telnyx:', err.message);
    return { status: 'delivery_failed', error: err.message, reply: msg };
  }
  return { status: 'filtered', reply: msg };
}

// --- AI turn ---
// Each step is individually isolated. A failure in saving, logging, or fetching
// memory never prevents the AI call or the reply from being delivered.

async function runAiTurn(env, ctx, db, phoneNumber, text, returnResult, modelOverride) {
  const encryptionKey = env.ENCRYPTION_KEY;
  const conversation = await getOrCreateActiveConversation(db, phoneNumber);
  const history = await getConversationHistory(db, conversation.id, phoneNumber, encryptionKey);

  // Save user message — isolated so a D1 or encryption hiccup doesn't abort the
  // AI call. If encryption fails we log and continue rather than silently storing
  // plaintext — the message may be missing from history on retry, which is acceptable.
  try {
    await saveMessage(db, conversation.id, 'user', text, phoneNumber, encryptionKey);
  } catch (err) {
    console.error('Failed to save user message (continuing):', err.message);
  }

  // Log inbound to Sheets — sheets.js has its own catch but we wrap defensively.
  // Note: only metadata (length, role, etc.) is logged, never message content.
  try {
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'user',
      message: text,
    });
  } catch (err) {
    console.error('Failed to log user message to Sheets (continuing):', err.message);
  }

  // Fetch and decrypt any stored memory for this number — isolated, best-effort.
  // Skipped entirely if the number has incognito mode on. A failure here just
  // means the AI call proceeds without memory context; it never blocks the reply.
  const memoryFacts = await fetchMemoryFacts(db, phoneNumber, encryptionKey);

  // AI call — on total failure returns a safe fallback string with systemError: true,
  // never throws
  const result = await callAi(env, phoneNumber, history, text, modelOverride, memoryFacts);

  if (result.blocked) {
    // Limit-reached notice — delivered below, never saved or used for naming/memory.
  } else if (result.systemError) {
    // Save this exact error text at most once per outage streak. `history` here is
    // the state BEFORE this turn, so its last entry is whatever the previous turn
    // produced — if that was already this same error text, we're mid-retry-storm
    // and skip writing a duplicate. Naming/memory never trigger for error turns.
    const lastEntry = history[history.length - 1];
    const alreadyRecorded = lastEntry && lastEntry.role === 'assistant' && lastEntry.content === result.text;

    if (!alreadyRecorded) {
      try {
        await saveMessage(db, conversation.id, 'assistant', result.text, phoneNumber, encryptionKey);
      } catch (err) {
        console.error('Failed to save system-error message (continuing):', err.message);
      }
    }
  } else {
    // Normal successful reply — save and trigger naming/memory as usual.
    try {
      await saveMessage(db, conversation.id, 'assistant', result.text, phoneNumber, encryptionKey);
      ctx.waitUntil(maybeAutoNameConversation(env, conversation.id, phoneNumber, history.length + 2));
      ctx.waitUntil(maybeExtractMemory(env, conversation.id, phoneNumber));
    } catch (err) {
      console.error('Failed to save assistant message (continuing):', err.message);
    }
  }

  // Log outbound to Sheets — isolated, never blocks delivery. Runs unconditionally
  // on every attempt (including deduped repeats), so Sheets remains the complete
  // outage audit trail even for retries that didn't get written to history above.
  try {
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'assistant',
      message: result.text,
      modelUsed: result.modelUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  } catch (err) {
    console.error('Failed to log assistant message to Sheets (continuing):', err.message);
  }

  // Deliver reply — isolated so a Telnyx failure doesn't trigger the generic
  // error handler and potentially send a confusing second message
  try {
    await deliverReply(env, phoneNumber, result.text);
  } catch (err) {
    console.error('Failed to deliver reply via Telnyx:', err.message);
    return returnResult
      ? { status: 'delivery_failed', error: err.message, reply: result.text }
      : undefined;
  }

  return {
    status: 'ok',
    reply: result.text,
    modelUsed: result.modelUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

// --- Memory fetch (isolated, best-effort) ---

async function fetchMemoryFacts(db, phoneNumber, encryptionKey) {
  if (!encryptionKey) return null;

  try {
    const memRow = await getMemoryRow(db, phoneNumber);
    if (!memRow || memRow.incognito || !memRow.encrypted_facts) return null;

    const decrypted = await decryptMessage(phoneNumber, memRow.encrypted_facts, encryptionKey, 'memory');
    if (!decrypted) return null;

    const facts = JSON.parse(decrypted);
    return Array.isArray(facts) ? facts : null;
  } catch (err) {
    console.error('Memory fetch/decrypt error (continuing without memory):', err.message);
    return null;
  }
}

// --- AI call with fallback response ---
// Never throws — always returns a valid result shape. On failure, the returned
// object is flagged systemError: true so callers know to dedupe it against history
// instead of persisting every retry (see the gating in runAiTurn above).

async function callAi(env, phoneNumber, history, text, modelOverride, memoryFacts) {
  try {
    return await getOpenRouterResponse(env, phoneNumber, history, text, modelOverride, memoryFacts);
  } catch (err) {
    console.error('OpenRouter error:', err);
    return {
      text: "Sorry, I'm having trouble thinking right now. Please try again in a moment!",
      modelUsed: null,
      inputTokens: 0,
      outputTokens: 0,
      blocked: false,
      systemError: true,
    };
  }
}

// --- Top-level pipeline error handler ---
// Only reached if something outside runAiTurn throws (access checks, command
// handling, D1 on getOrCreateActiveConversation, etc.)

async function handlePipelineError(env, phoneNumber, err, returnResult) {
  try {
    const msg = "Something went wrong on my end. Please try again!";
    await deliverReply(env, phoneNumber, msg);
    return returnResult ? { status: 'error', error: err.message } : undefined;
  } catch (sendErr) {
    console.error('Failed to send pipeline error message:', sendErr.message);
    return returnResult
      ? { status: 'error', error: err.message, sendError: sendErr.message }
      : undefined;
  }
}
