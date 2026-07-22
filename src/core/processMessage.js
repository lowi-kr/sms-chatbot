// core/processMessage.js - Main message processing pipeline
// Called by both the Telnyx webhook handler and the /test route.
// returnResult: when true, returns a summary object (used by /test endpoint)
// modelOverride: forces a specific model, skipping D1 resolution (used by test console picker)
//
// Error isolation contract:
//   - Access checks, command handling, and content filtering are allowed to abort early.
//   - Inside runAiTurn, each step (save, log, AI call, deliver) is isolated so one
//     failure never silently prevents the steps that follow from running.
//   - sheets.js has its own internal try/catch but we wrap it here too so a future
//     regression there can never take down the pipeline.

import { parseCommand, handleCommand } from '../commands.js';
import { containsBlockedContent } from '../filter.js';
import { getOpenRouterResponse } from '../openrouter.js';
import { logToSheets, logFilteredMessage } from '../sheets.js';
import {
  isBlacklisted, isWhitelisted, hasWhitelistEntries,
  getOrCreateActiveConversation, getConversationHistory, saveMessage,
} from '../db/index.js';
import { maybeAutoNameConversation } from './autoNaming.js';
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
    await deliverReply(env, phoneNumber, msg);
    return { status: 'not_whitelisted', reply: msg };
  }

  return null;
}

// --- Slash commands ---

async function tryHandleCommand(env, db, phoneNumber, text) {
  const parsed = parseCommand(text);
  if (!parsed) return null;

  const response = await handleCommand(parsed.command, parsed.args, phoneNumber, db);
  await deliverReply(env, phoneNumber, response);
  return { status: 'command', reply: response };
}

// --- Content filter ---

async function handleFilteredMessage(env, phoneNumber, text) {
  // logFilteredMessage has its own internal try/catch and never throws
  await logFilteredMessage(env, { phoneNumber, message: text });
  const msg = "Sorry, I can't respond to that kind of message. Please keep our conversation appropriate.";
  await deliverReply(env, phoneNumber, msg);
  return { status: 'filtered', reply: msg };
}

// --- AI turn ---
// Each step is individually isolated. A failure in saving or logging never
// prevents the AI call or the reply from being delivered.

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

  // AI call — on total failure returns a safe fallback string, never throws
  const result = await callAi(env, phoneNumber, history, text, modelOverride);

  // Save assistant reply — only if not a limit-block message, so blocked notices
  // don't pollute the conversation context
  if (!result.blocked) {
    try {
      await saveMessage(db, conversation.id, 'assistant', result.text, phoneNumber, encryptionKey);
      ctx.waitUntil(maybeAutoNameConversation(env, conversation.id, phoneNumber, history.length + 2));
    } catch (err) {
      console.error('Failed to save assistant message (continuing):', err.message);
    }
  }

  // Log outbound to Sheets — isolated, never blocks delivery
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

// --- AI call with fallback response ---
// Never throws — always returns a valid result shape.

async function callAi(env, phoneNumber, history, text, modelOverride) {
  try {
    return await getOpenRouterResponse(env, phoneNumber, history, text, modelOverride);
  } catch (err) {
    console.error('OpenRouter error:', err);
    return {
      text: "Sorry, I'm having trouble thinking right now. Please try again in a moment!",
      modelUsed: null,
      inputTokens: 0,
      outputTokens: 0,
      blocked: false,
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
