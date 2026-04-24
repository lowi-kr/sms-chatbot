// telnyx.js - Send SMS/MMS via Telnyx API v2

export async function sendSMS(env, to, message) {
  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.TELNYX_PHONE_NUMBER,
      to: to,
      text: message,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Telnyx send error:', error);
    throw new Error(`Telnyx API error: ${response.status}`);
  }

  return await response.json();
}

export async function sendMMS(env, to, message, mediaUrl) {
  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.TELNYX_PHONE_NUMBER,
      to: to,
      text: message,
      media_urls: [mediaUrl],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Telnyx MMS send error:', error);
    throw new Error(`Telnyx MMS API error: ${response.status}`);
  }

  return await response.json();
}

export function parseInboundWebhook(body) {
  // Extract relevant fields from Telnyx v2 webhook
  const data = body?.data?.payload;
  if (!data) return null;

  return {
    from: data.from?.phone_number,
    to: data.to?.[0]?.phone_number,
    text: data.text || '',
    mediaUrls: data.media?.map(m => m.url) || [],
    messageId: data.id,
    direction: data.direction,
  };
}
