// handlers/webhook.js - Handles POST /webhook from Telnyx.
// Returns 200 immediately and processes the message in the background via ctx.waitUntil.

import { parseInboundWebhook } from '../integrations/telnyx.js';
import { processMessage } from '../core/processMessage.js';
import { verifyTelnyxSignature } from '../security/telnyxSignature.js';
import { isValidPhone, MAX_MESSAGE_LENGTH } from '../security/validate.js';

export async function handleWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const verification = await verifyTelnyxSignature(
    env,
    rawBody,
    request.headers.get('telnyx-signature-ed25519'),
    request.headers.get('telnyx-timestamp')
  );
  if (!verification.ok) {
    console.error('Rejected /webhook request: ' + verification.reason);
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
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
  if (!isValidPhone(msg.from) || typeof msg.text !== 'string' || msg.text.length > MAX_MESSAGE_LENGTH) {
    console.error('Rejected /webhook message: invalid phone number or message length');
    return new Response('OK', { status: 200 });
  }

  ctx.waitUntil(processMessage(env, ctx, msg.from, msg.text));
  return new Response('OK', { status: 200 });
}
