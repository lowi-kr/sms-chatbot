// admin/send.js - Admin-initiated outbound SMS.
// Reuses the same integrations/telnyx.js module the bot uses — no duplicated
// Telnyx logic, and TELNYX_API_KEY / TELNYX_PHONE_NUMBER are read from the
// same env this worker already has (no separate admin-api secrets needed).

import { json, readJsonBody } from './helpers.js';
import { sendSMS } from '../integrations/telnyx.js';

export async function handleSend(request, env, path) {
  if (path !== '/api/send' || request.method !== 'POST') return null;

  const { body, error } = await readJsonBody(request);
  if (error) return error;
  const { to, message } = body;
  if (!to || !message) return json({ error: 'Missing to or message' }, 400);

  try {
    const data = await sendSMS(env, to, message);
    return json({ success: true, message_id: data.data?.id });
  } catch (err) {
    console.error('Admin send SMS error:', err.message);
    return json({ error: err.message }, 502);
  }
}
