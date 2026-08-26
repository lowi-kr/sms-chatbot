// admin/send.js - Admin-initiated outbound SMS.
// Reuses the same integrations/telnyx.js module the bot uses — no duplicated
// Telnyx logic, and TELNYX_API_KEY / TELNYX_PHONE_NUMBER are read from the
// same env this worker already has (no separate admin-api secrets needed).

import { json } from './helpers.js';
import { sendSMS } from '../integrations/telnyx.js';
import { isValidPhone, normalizePhone, MAX_MESSAGE_LENGTH } from '../security/validate.js';

export async function handleSend(request, env, path) {
  if (path !== '/api/send' || request.method !== 'POST') return null;

  const body = await request.json().catch(() => ({}));
  const to = normalizePhone(body.to);
  const { message } = body;
  if (!isValidPhone(to)) {
    return json({ error: 'The "to" field must be a valid E.164 phone number' }, 400);
  }
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `"message" must be a non-empty string of at most ${MAX_MESSAGE_LENGTH} characters` }, 400);
  }

  try {
    const data = await sendSMS(env, to, message);
    return json({ success: true, message_id: data.data?.id });
  } catch (err) {
    console.error('Admin send SMS error:', err.message);
    return json({ error: err.message }, 502);
  }
}
