// index.js - Main Cloudflare Worker entry point
// TEST MODE: set env.TEST_MODE = "true" (Cloudflare variable, not secret) to log
// AI replies instead of sending via Telnyx, and to enable /test and /test-ui routes.
// Nothing related to testing touches Telnyx or requires a phone number.

import { parseInboundWebhook, sendSMS } from './telnyx.js';
import { parseCommand, handleCommand } from './commands.js';
import { containsBlockedContent } from './filter.js';
import { getOpenRouterResponse } from './openrouter.js';
import { logToSheets, logFilteredMessage } from './sheets.js';
import { TEST_PAGE_HTML } from './testpage.js';
import {
  isBlacklisted, isWhitelisted, hasWhitelistEntries,
  getOrCreateActiveConversation, getConversationHistory,
  saveMessage
} from './db.js';

const TEST_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Swaps out the real Telnyx send for a console log when TEST_MODE is enabled.
async function deliverReply(env, phoneNumber, message) {
  if (env.TEST_MODE === 'true') {
    console.log(`[TEST_MODE] Would send to ${phoneNumber}:\n${message}`);
    return;
  }
  await sendSMS(env, phoneNumber, message);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Standalone test UI — only served when TEST_MODE is on. No auth, no dashboard.
    if (url.pathname === '/test-ui' && request.method === 'GET') {
      if (env.TEST_MODE !== 'true') {
        return new Response('Test UI is disabled. Set TEST_MODE=true on this worker to enable it.', { status: 404 });
      }
      return new Response(TEST_PAGE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // CORS preflight for the test API (harmless to leave enabled even outside TEST_MODE)
    if (url.pathname === '/test' && request.method === 'OPTIONS') {
      return new Response(null, { headers: TEST_CORS_HEADERS });
    }

    // Test endpoint: POST { "from": "+1...", "text": "hello" } directly,
    // skipping the Telnyx payload shape entirely. Only active when TEST_MODE is "true".
    if (url.pathname === '/test' && request.method === 'POST') {
      if (env.TEST_MODE !== 'true') {
        return new Response('Test endpoint is disabled. Set TEST_MODE=true on this worker to enable it.', { status: 404 });
      }
      const body = await request.json().catch(() => ({}));
      if (!body.from || !body.text) {
        return new Response('Body must include "from" and "text"', { status: 400, headers: TEST_CORS_HEADERS });
      }
      // Run synchronously (not waitUntil) so the HTTP response includes the result.
      const result = await processMessage(env, body.from, body.text, true);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...TEST_CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Only handle POST to /webhook
    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // Only process inbound messages
    const eventType = body?.data?.event_type;
    if (eventType !== 'message.received') {
      return new Response('OK', { status: 200 });
    }

    const msg = parseInboundWebhook(body);
    if (!msg || !msg.from || !msg.text) {
      return new Response('OK', { status: 200 });
    }

    const { from: phoneNumber, text } = msg;

    // Process in background so we return 200 to Telnyx quickly
    ctx.waitUntil(processMessage(env, phoneNumber, text));

    return new Response('OK', { status: 200 });
  },
};

// returnResult: when true, returns a summary object instead of just logging (used by /test)
async function processMessage(env, phoneNumber, text, returnResult = false) {
  try {
    const db = env.DB;

    // 1. Check blacklist
    if (await isBlacklisted(db, phoneNumber)) {
      console.log(`Blocked message from blacklisted number: ${phoneNumber}`);
      return returnResult ? { status: 'blacklisted' } : undefined;
    }

    // 2. Check whitelist (only enforced if whitelist has entries)
    const whitelistActive = await hasWhitelistEntries(db);
    if (whitelistActive && !(await isWhitelisted(db, phoneNumber))) {
      const msg = "Sorry, this chatbot is private. You don't have access.";
      await deliverReply(env, phoneNumber, msg);
      return returnResult ? { status: 'not_whitelisted', reply: msg } : undefined;
    }

    // 3. Handle slash commands
    const parsed = parseCommand(text);
    if (parsed) {
      const response = await handleCommand(parsed.command, parsed.args, phoneNumber, db);
      await deliverReply(env, phoneNumber, response);
      return returnResult ? { status: 'command', reply: response } : undefined;
    }

    // 4. Content filter check
    if (containsBlockedContent(text)) {
       await logFilteredMessage(env, {
          phoneNumber,
          message: text,
       });
       const msg = "Sorry, I can't respond to that kind of message. Please keep our conversation appropriate.";
       await deliverReply(env, phoneNumber, msg);
       return returnResult ? { status: 'filtered', reply: msg } : undefined;
    }

    // 5. Get or create active conversation
    const conversation = await getOrCreateActiveConversation(db, phoneNumber);

    // 6. Get full conversation history
    const history = await getConversationHistory(db, conversation.id);

    // 7. Save user message
    await saveMessage(db, conversation.id, 'user', text);

    // 8. Log user message to Google Sheets (no model/tokens for inbound user messages)
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'user',
      message: text,
    });

    // 9. Get AI response (via OpenRouter, with per-number model/limit/fallback resolution)
    let result;
    try {
      result = await getOpenRouterResponse(env, phoneNumber, history, text);
    } catch (err) {
      console.error('OpenRouter error:', err);
      result = {
        text: "Sorry, I'm having trouble thinking right now. Please try again in a moment!",
        modelUsed: null,
        inputTokens: 0,
        outputTokens: 0,
        blocked: false,
      };
    }

    // 10. Save AI response (only persist to conversation history if not a limit-block message,
    //     so blocked notices don't pollute the actual chat context)
    if (!result.blocked) {
      await saveMessage(db, conversation.id, 'assistant', result.text);
    }

    // 11. Log AI response to Google Sheets (with model + token usage)
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'assistant',
      message: result.text,
      modelUsed: result.modelUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });

    // 12. Deliver response (real SMS, or console log in TEST_MODE)
    await deliverReply(env, phoneNumber, result.text);

    return returnResult ? { status: 'ok', reply: result.text, modelUsed: result.modelUsed, inputTokens: result.inputTokens, outputTokens: result.outputTokens } : undefined;

  } catch (err) {
    console.error('Error processing message:', err);
    try {
      const msg = "Something went wrong on my end. Please try again!";
      await deliverReply(env, phoneNumber, msg);
      return returnResult ? { status: 'error', error: err.message } : undefined;
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr);
      return returnResult ? { status: 'error', error: err.message, sendError: sendErr.message } : undefined;
    }
  }
}
