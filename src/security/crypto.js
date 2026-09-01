// crypto.js - AES-256-GCM encryption with per-phone key derivation
// Each phone number gets a unique key derived from: phone + ENCRYPTION_KEY pepper + purpose
// "purpose" domain-separates different data types (messages vs memory) sharing the same pepper,
// so compromising one derived key does not help decrypt the other.

import { hexToBytes, bytesToBase64, base64ToBytes } from '../utils/encoding.js';

const ALGO = { name: 'AES-GCM', length: 256 };

// Validates the pepper shape BEFORE we ever touch WebCrypto. Without this,
// a missing/malformed ENCRYPTION_KEY produces a confusing low-level error deep
// inside hexToBytes ("Invalid hex string", or "Cannot read properties of
// undefined (reading 'length')") with no indication of what's actually wrong
// or how to fix it. This throws one clear, actionable message instead.
function validateEncryptionKeyHex(encryptionKeyHex) {
  if (!encryptionKeyHex) {
    throw new Error(
      'ENCRYPTION_KEY is not set. This worker cannot encrypt or decrypt messages ' +
      'without it — set a 64-character hex string (32 random bytes) as a secret ' +
      'on this worker (Settings → Variables → Add secret → ENCRYPTION_KEY).'
    );
  }
  if (typeof encryptionKeyHex !== 'string' || !/^[0-9a-fA-F]+$/.test(encryptionKeyHex)) {
    throw new Error('ENCRYPTION_KEY is malformed — expected a hex string (0-9, a-f only).');
  }
  if (encryptionKeyHex.length !== 64) {
    throw new Error(
      `ENCRYPTION_KEY has the wrong length (${encryptionKeyHex.length} hex chars, expected 64 ` +
      `— i.e. 32 bytes). Generate a fresh one, e.g. via 'openssl rand -hex 32', and note that ` +
      `rotating it will make all previously-stored messages permanently undecryptable.`
    );
  }
}

/**
 * Derive a unique AES-256-GCM key for a given phone number + purpose.
 * purpose defaults to 'msg' to preserve the exact original info string for existing
 * encrypted message data — do not change the default without a migration plan.
 */
async function deriveKey(phoneNumber, encryptionKeyHex, purpose = 'msg') {
  validateEncryptionKeyHex(encryptionKeyHex);

  if (!phoneNumber) {
    throw new Error('deriveKey called without a phoneNumber — cannot derive a per-phone key.');
  }

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
 *
 * Throws on failure (bad key, WebCrypto error) — callers must not swallow this
 * silently, since falling back to plaintext storage would be a silent privacy
 * breach. See db/conversations.js saveMessage for the calling convention.
 */
export async function encryptMessage(phoneNumber, plaintext, encryptionKeyHex, purpose = 'msg') {
  if (typeof plaintext !== 'string') {
    throw new Error(`encryptMessage expected a string, got ${typeof plaintext}`);
  }

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
 * Returns null if decryption fails (wrong key, corrupted data, etc.) — this
 * function intentionally does NOT throw, because callers (getConversationHistory)
 * need to substitute a placeholder for one bad row rather than aborting an
 * entire conversation fetch. The error is still logged with context so it's
 * debuggable, distinguishing three common causes: missing/bad ENCRYPTION_KEY
 * (config problem, affects everything), malformed base64 (corrupted row), and
 * GCM auth-tag failure (wrong key was used, e.g. ENCRYPTION_KEY was rotated).
 * purpose must match whatever was used to encrypt (default 'msg').
 */
export async function decryptMessage(phoneNumber, encryptedBase64, encryptionKeyHex, purpose = 'msg') {
  try {
    const key = await deriveKey(phoneNumber, encryptionKeyHex, purpose);
    const combined = base64ToBytes(encryptedBase64);

    if (combined.length < 13) {
      // 12-byte IV + at least 1 byte ciphertext — anything shorter can't be valid
      console.error(`Decryption failed for ${phoneNumber} (purpose=${purpose}): stored value too short to be valid ciphertext`);
      return null;
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  } catch (err) {
    // err.message from validateEncryptionKeyHex() surfaces a config problem;
    // a WebCrypto "OperationError" here almost always means the wrong key
    // decrypted this blob (most commonly: ENCRYPTION_KEY was rotated/changed
    // after this row was written).
    console.error(`Decryption failed for ${phoneNumber} (purpose=${purpose}):`, err.message);
    return null;
  }
}
