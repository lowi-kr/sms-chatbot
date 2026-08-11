// telnyx.js - Send SMS/MMS via Telnyx API v2

async function sendMessage(env, to, text, mediaUrls = []) {
  const body = {
    from: env.TELNYX_PHONE_NUMBER,
    to,
    text,
  };
  if (mediaUrls.length > 0) {
    body.media_urls = mediaUrls;
  }

  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => '(unreadable)');
    console.error('Telnyx send error:', error);
    throw new Error(`Telnyx API error: ${response.status}`);
  }

  return response.json();
}

export function sendSMS(env, to, text) {
  return sendMessage(env, to, text);
}

export function sendMMS(env, to, text, mediaUrl) {
  return sendMessage(env, to, text, [mediaUrl]);
}

export function parseInboundWebhook(body) {
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
