// handlers/webhook.js - Handles POST /webhook from Telnyx.
// Returns 200 immediately and processes the message in the background via ctx.waitUntil.

import { parseInboundWebhook } from '../telnyx.js';
import { processMessage } from '../core/processMessage.js';

export async function handleWebhook(request, env, ctx) {
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

  ctx.waitUntil(processMessage(env, ctx, msg.from, msg.text));
  return new Response('OK', { status: 200 });
}
