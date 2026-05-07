// index.js - Main Cloudflare Worker entry point

import { parseInboundWebhook, sendSMS } from './telnyx.js';
import { parseCommand, handleCommand } from './commands.js';
import { containsBlockedContent } from './filter.js';
import { getGeminiResponse } from './gemini.js';
import { logToSheets, logFilteredMessage } from './sheets.js';
import {
  isBlacklisted, isWhitelisted, hasWhitelistEntries,
  getOrCreateActiveConversation, getConversationHistory,
  saveMessage
} from './db.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      return new Response('Not Found', { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const eventType = body?.data?.event_type;
    if (eventType !== 'message.received') {
      return new Response('OK', { status: 200 });
    }

    const msg = parseInboundWebhook(body);
    if (!msg || !msg.from || !msg.text) {
      return new Response('OK', { status: 200 });
    }

    const { from: phoneNumber, text } = msg;

    ctx.waitUntil(processMessage(env, phoneNumber, text));

    return new Response('OK', { status: 200 });
  },
};

async function processMessage(env, phoneNumber, text) {
  try {
    const db = env.DB;

    // Validate ENCRYPTION_KEY is set
    if (!env.ENCRYPTION_KEY) {
      console.error('ENCRYPTION_KEY secret is not set — messages cannot be encrypted.');
      await sendSMS(env, phoneNumber, "Sorry, the bot is misconfigured. Please contact support.");
      return;
    }

    // 1. Check blacklist
    if (await isBlacklisted(db, phoneNumber)) {
      console.log(`Blocked message from blacklisted number: ${phoneNumber}`);
      return;
    }

    // 2. Check whitelist
    const whitelistActive = await hasWhitelistEntries(db);
    if (whitelistActive && !(await isWhitelisted(db, phoneNumber))) {
      await sendSMS(env, phoneNumber, "Sorry, this chatbot is private. You don't have access.");
      return;
    }

    // 3. Handle slash commands
    const parsed = parseCommand(text);
    if (parsed) {
      const response = await handleCommand(parsed.command, parsed.args, phoneNumber, db);
      await sendSMS(env, phoneNumber, response);
      return;
    }

    // 4. Content filter check
    if (containsBlockedContent(text)) {
      await logFilteredMessage(env, { phoneNumber, message: text });
      await sendSMS(env, phoneNumber,
        "Sorry, I can't respond to that kind of message. Please keep our conversation appropriate."
      );
      return;
    }

    // 5. Get or create active conversation
    const conversation = await getOrCreateActiveConversation(db, phoneNumber);

    // 6. Get full conversation history (decrypted)
    const history = await getConversationHistory(db, conversation.id, phoneNumber, env.ENCRYPTION_KEY);

    // 7. Save user message (encrypted)
    await saveMessage(db, conversation.id, 'user', text, phoneNumber, env.ENCRYPTION_KEY);

    // 8. Log to Google Sheets (metadata only — no message content)
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'user',
      message: text,
    });

    // 9. Get Gemini response
    let aiResponse;
    try {
      aiResponse = await getGeminiResponse(env, history, text);
    } catch (err) {
      console.error('Gemini error:', err);
      aiResponse = "Sorry, I'm having trouble thinking right now. Please try again in a moment!";
    }

    // 10. Save AI response (encrypted)
    await saveMessage(db, conversation.id, 'assistant', aiResponse, phoneNumber, env.ENCRYPTION_KEY);

    // 11. Log AI response to Google Sheets
    await logToSheets(env, {
      phoneNumber,
      conversationName: conversation.name,
      role: 'assistant',
      message: aiResponse,
    });

    // 12. Send response via SMS
    await sendSMS(env, phoneNumber, aiResponse);

  } catch (err) {
    console.error('Error processing message:', err);
    try {
      await sendSMS(env, phoneNumber, "Something went wrong on my end. Please try again!");
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr);
    }
  }
}
