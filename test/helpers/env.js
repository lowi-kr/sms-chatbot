import { vi } from 'vitest';
import { makeDb } from './fakeDb.js';

export function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
    OPENROUTER_API_KEY: 'openrouter-test-key',
    TELNYX_API_KEY: 'telnyx-test-key',
    TELNYX_PHONE_NUMBER: '+15555550100',
    ADMIN_SECRET: 'admin-test-secret',
    TEST_MODE: 'true',
    ...overrides,
  };
}

export function makeCtx() {
  return { waitUntil: vi.fn(p => p) };
}
