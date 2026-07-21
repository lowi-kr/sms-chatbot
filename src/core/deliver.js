// core/deliver.js - Delivers a reply either via Telnyx SMS or console log in TEST_MODE.

import { sendSMS } from '../telnyx.js';

export async function deliverReply(env, phoneNumber, message) {
  if (env.TEST_MODE === 'true') {
    console.log(`[TEST_MODE] Would send to ${phoneNumber}:\n${message}`);
    return;
  }
  await sendSMS(env, phoneNumber, message);
}
