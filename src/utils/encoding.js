// utils/encoding.js - Byte/base64/hex conversion helpers shared by everything
// that has to move binary data through Workers' btoa/atob (security/crypto.js
// for AES blobs, integrations/sheets.js for the service-account JWT).

export function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string (odd length)');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  let binary;
  try {
    binary = atob(base64);
  } catch (err) {
    throw new Error(`Stored value is not valid base64: ${err.message}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Base64url (RFC 4648 §5, unpadded) — the encoding JWTs use.
export function toBase64Url(base64) {
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlFromString(str) {
  return toBase64Url(btoa(str));
}

export function base64UrlFromBytes(bytes) {
  return toBase64Url(bytesToBase64(bytes));
}
