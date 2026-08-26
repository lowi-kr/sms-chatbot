// security/telnyxSignature.js - Verifies signed inbound Telnyx webhook payloads.
// Telnyx signs the exact timestamp-prefixed request body with Ed25519.

const REPLAY_TOLERANCE_SECONDS = 300;

function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid base64');
  }

  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function verifyTelnyxSignature(env, rawBody, signatureHeader, timestampHeader) {
  try {
    if (!env.TELNYX_PUBLIC_KEY ||
        (typeof env.TELNYX_PUBLIC_KEY === 'string' && env.TELNYX_PUBLIC_KEY.trim() === '')) {
      return {
        ok: false,
        reason: 'TELNYX_PUBLIC_KEY is not configured — add the Telnyx portal Public Key as a worker secret.',
      };
    }
    if (!signatureHeader || !timestampHeader) {
      return { ok: false, reason: 'Telnyx signature or timestamp header is missing.' };
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp) || timestampHeader.trim() === '') {
      return { ok: false, reason: 'Telnyx timestamp header is invalid.' };
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > REPLAY_TOLERANCE_SECONDS) {
      return { ok: false, reason: 'Telnyx webhook timestamp is outside the replay tolerance.' };
    }

    const publicKey = decodeBase64(env.TELNYX_PUBLIC_KEY);
    const signature = decodeBase64(signatureHeader);
    const payload = new TextEncoder().encode(`${timestampHeader}|${rawBody}`);
    let key;
    let algorithm = { name: 'Ed25519' };

    try {
      key = await crypto.subtle.importKey('raw', publicKey, algorithm, false, ['verify']);
    } catch {
      algorithm = { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' };
      key = await crypto.subtle.importKey('raw', publicKey, algorithm, false, ['verify']);
    }

    const valid = await crypto.subtle.verify(algorithm, key, signature, payload);
    return valid ? { ok: true } : { ok: false, reason: 'Telnyx webhook signature is invalid.' };
  } catch {
    return { ok: false, reason: 'Telnyx webhook signature could not be verified.' };
  }
}
