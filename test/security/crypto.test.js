import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptMessage, encryptMessage } from '../../src/security/crypto.js';
import { makeEnv } from '../helpers/env.js';

const key = makeEnv().ENCRYPTION_KEY;
const phone = '+15551234567';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('crypto', () => {
  it.each(['hello', 'こんにちは 👋', ''])('round trips %j', async plaintext => {
    const encrypted = await encryptMessage(phone, plaintext, key);
    expect(await decryptMessage(phone, encrypted, key)).toBe(plaintext);
  });

  it('uses a fresh IV and produces base64 ciphertext', async () => {
    const a = await encryptMessage(phone, 'same', key);
    const b = await encryptMessage(phone, 'same', key);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(a).not.toBe(b);
  });

  it('separates phone and purpose keys', async () => {
    const encrypted = await encryptMessage(phone, 'secret', key);
    expect(await decryptMessage('+15550000000', encrypted, key)).toBeNull();
    expect(await decryptMessage(phone, encrypted, key, 'memory')).toBeNull();
  });

  it.each([
    [undefined, 'not set'],
    ['xyz', 'malformed'],
    ['0'.repeat(63), 'wrong length'],
    ['0'.repeat(65), 'wrong length'],
  ])('validates encryption key (%s)', async (badKey, message) => {
    await expect(encryptMessage(phone, 'x', badKey)).rejects.toThrow(new RegExp(message, 'i'));
  });

  it('swallows validation errors when decrypting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(decryptMessage(phone, 'abc', undefined)).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('requires a phone number and string plaintext', async () => {
    await expect(encryptMessage(undefined, 'x', key)).rejects.toThrow(/phoneNumber/);
    await expect(encryptMessage(phone, 1, key)).rejects.toThrow('expected a string');
    await expect(encryptMessage(phone, null, key)).rejects.toThrow('expected a string');
    await expect(encryptMessage(phone, {}, key)).rejects.toThrow('expected a string');
  });

  it('returns null for invalid and too-short ciphertext', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await decryptMessage(phone, 'not base64!', key)).toBeNull();
    const short = btoa('123456789012');
    expect(await decryptMessage(phone, short, key)).toBeNull();
    error.mockRestore();
  });
});
