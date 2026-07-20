// crypto.js - AES-256-GCM encryption with per-phone key derivation
// Each phone number gets a unique key derived from: phone + ENCRYPTION_KEY pepper + purpose
// "purpose" domain-separates different data types (messages vs memory) sharing the same pepper,
// so compromising one derived key does not help decrypt the other.

const ALGO = { name: 'AES-GCM', length: 256 };

/**
 * Derive a unique AES-256-GCM key for a given phone number + purpose.
 * purpose defaults to 'msg' to preserve the exact original info string for existing
 * encrypted message data — do not change the default without a migration plan.
 */
async function deriveKey(phoneNumber, encryptionKeyHex, purpose = 'msg') {
  // Import the pepper (ENCRYPTION_KEY) as raw key material
  const pepper = hexToBytes(encryptionKeyHex);
  const baseKey = await crypto.subtle.importKey(
    'raw', pepper,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  // Use the phone number + purpose as the HKDF "info" so each phone/purpose gets a unique key
  const info = new TextEncoder().encode(`sms-chatbot-${purpose}-key:${phoneNumber}`);
  const salt = new TextEncoder().encode('sms-chatbot-v1');

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    ALGO,
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string for a given phone number.
 * Returns a base64 string: iv (12 bytes) + ciphertext
 * purpose: domain-separation label (default 'msg' for conversation messages,
 * pass 'memory' for the memory table). Same pepper, cryptographically independent keys.
 */
export async function encryptMessage(phoneNumber, plaintext, encryptionKeyHex, purpose = 'msg') {
  const key = await deriveKey(phoneNumber, encryptionKeyHex, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // Combine iv + ciphertext into a single base64 blob
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  return bytesToBase64(combined);
}

/**
 * Decrypt a base64 blob back to plaintext for a given phone number.
 * Returns null if decryption fails (wrong key, corrupted data, etc.)
 * purpose must match whatever was used to encrypt (default 'msg').
 */
export async function decryptMessage(phoneNumber, encryptedBase64, encryptionKeyHex, purpose = 'msg') {
  try {
    const key = await deriveKey(phoneNumber, encryptionKeyHex, purpose);
    const combined = base64ToBytes(encryptedBase64);

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null;
  }
}

// ---- Helpers ----

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}