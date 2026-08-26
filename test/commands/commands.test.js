import { describe, expect, it, vi } from 'vitest';
import { handleCommand, parseCommand } from '../../src/commands/commands.js';
import { makeDb } from '../helpers/fakeDb.js';
import { makeEnv } from '../helpers/env.js';
import { decryptMessage, encryptMessage } from '../../src/security/crypto.js';

const phone = '+15551234567';
const env = makeEnv();

describe('parseCommand', () => {
  it('parses slash commands and normalizes whitespace/case', () => {
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('  /HELP   one   two  ')).toEqual({ command: '/help', args: 'one   two' });
    expect(parseCommand('/help')).toEqual({ command: '/help', args: '' });
  });
});

describe('handleCommand', () => {
  it('dispatches every known command and unknown commands', async () => {
    expect(await handleCommand('/help', '', phone, makeDb())).toContain('/new');
    expect(await handleCommand('/new', '', phone, makeDb([
      { match: 'UPDATE conversations' }, { match: 'INSERT INTO conversations', run: { meta: { last_row_id: 2 } } },
    ]))).toContain('ID: 2');
    const common = () => makeDb([{ match: 'UPDATE conversations', run: { meta: { changes: 1 } } }]);
    expect(await handleCommand('/save', 'Name', phone, common())).toContain('Name');
    expect(await handleCommand('/rename', 'Name', phone, common())).toContain('Name');
    const listDb = makeDb([{ match: 'SELECT id, name, is_active', all: [] }]);
    expect(await handleCommand('/list', '', phone, listDb)).toContain('No conversations');
    expect(await handleCommand('/load', 'abc', phone, makeDb())).toContain('provide a conversation ID');
    expect(await handleCommand('/delete', 'abc', phone, makeDb())).toContain('provide a conversation ID');
    expect(await handleCommand('/support', '', phone, makeDb())).toContain('include your message');
    expect(await handleCommand('/memory', '', phone, makeDb([{ match: 'FROM memory', first: null }]), env)).toContain('stored memory');
    expect(await handleCommand('/forget-memory', '', phone, makeDb([{ match: 'FROM memory', first: null }]), env)).toContain('nothing');
    expect(await handleCommand('/wat', '', phone, makeDb())).toContain('Unknown command');
  });

  it('/save prompts, handles no active conversation, and succeeds', async () => {
    expect(await handleCommand('/save', '', phone, makeDb())).toContain('provide a name');
    expect(await handleCommand('/save', 'x', phone, makeDb([{ match: 'UPDATE conversations', run: { meta: { changes: 0 } } }]))).toContain('No active');
    expect(await handleCommand('/save', 'x', phone, makeDb([{ match: 'UPDATE conversations' }]))).toContain('x');
  });

  it('renames by id and active conversation', async () => {
    const notFound = makeDb([{ match: 'UPDATE conversations', run: { meta: { changes: 0 } } }]);
    expect(await handleCommand('/rename', '7 New', phone, notFound)).toContain('#7 not found');
    expect(await handleCommand('/rename', '7', phone, makeDb())).toContain('Example: /rename 7');
    expect(await handleCommand('/rename', '', phone, makeDb())).toContain('provide a name');
    expect(await handleCommand('/rename', 'New', phone, makeDb([{ match: 'UPDATE conversations' }]))).toContain('New');
  });

  it('/list formats active marker and message count', async () => {
    const db = makeDb([{ match: 'SELECT id, name, is_active', all: [
      { id: 2, name: 'Chat', is_active: 1, updated_at: '2025-01-01', msg_count: 3 },
      { id: 1, name: 'Old', is_active: 0, updated_at: '2025-01-01', msg_count: 0 },
    ] }]);
    const result = await handleCommand('/list', '', phone, db);
    expect(result).toContain('#2 Chat ← active');
    expect(result).toContain('3 messages');
  });

  it('/load validates, finds, deactivates and activates', async () => {
    expect(await handleCommand('/load', 'abc', phone, makeDb())).toContain('provide a conversation ID');
    expect(await handleCommand('/load', '9', phone, makeDb([{ match: 'SELECT id, name', first: null }]))).toContain('#9 not found');
    const db = makeDb([
      { match: 'SELECT id, name', first: { id: 9, name: 'Loaded' } },
      { match: 'UPDATE conversations', run: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }] },
      { match: 'SELECT COUNT(*)', first: { count: 4 } },
    ]);
    expect(await handleCommand('/load', '9', phone, db)).toContain('Loaded');
    expect(db.calls.filter(c => c.method === 'run').map(c => c.args)).toEqual([[phone], [9]]);
  });

  it('/delete removes inactive chats and starts a replacement for active chats', async () => {
    const inactive = makeDb([{ match: 'SELECT id, name, is_active', first: { id: 2, name: 'Old', is_active: 0 } }, { match: 'DELETE' }]);
    expect(await handleCommand('/delete', '2', phone, inactive)).toContain('Deleted "Old"');
    const active = makeDb([
      { match: 'SELECT id, name, is_active', first: { id: 2, name: 'Current', is_active: 1 } },
      { match: 'DELETE' }, { match: 'UPDATE conversations' }, { match: 'INSERT INTO conversations', run: { meta: { last_row_id: 3 } } },
    ]);
    expect(await handleCommand('/delete', '2', phone, active)).toContain('started a new conversation');
    expect(active.calls.some(c => c.sql.includes('DELETE FROM conversations'))).toBe(true);
    expect(active.calls.some(c => c.sql.includes('INSERT INTO conversations'))).toBe(true);
  });

  it('/support validates and stores trimmed text', async () => {
    expect(await handleCommand('/support', '  ', phone, makeDb())).toContain('include your message');
    const db = makeDb([{ match: 'INSERT INTO support_tickets' }]);
    expect(await handleCommand('/support', '  Help me  ', phone, db)).toContain('received');
    expect(db.calls[0].args).toEqual([phone, 'Help me']);
  });
});

describe('memory commands', () => {
  it('requires a key for memory and forgetting', async () => {
    expect(await handleCommand('/memory', '', phone, makeDb(), {})).toContain("isn't configured");
    expect(await handleCommand('/forget-memory', '', phone, makeDb(), {})).toContain("isn't configured");
  });

  it('views empty, malformed, and populated memory', async () => {
    const empty = makeDb([{ match: 'FROM memory', first: null }]);
    expect(await handleCommand('/memory', '', phone, empty, env)).toContain("don't have any stored memory");
    const noFacts = await encryptMessage(phone, JSON.stringify({ nope: true }), env.ENCRYPTION_KEY, 'memory');
    const noFactDb = makeDb([{ match: 'FROM memory', first: { encrypted_facts: noFacts, incognito: 0 } }]);
    expect(await handleCommand('/memory', '', phone, noFactDb, env)).toContain("don't have any stored memory");
    const blob = await encryptMessage(phone, JSON.stringify(['Likes tea', 'Has a cat']), env.ENCRYPTION_KEY, 'memory');
    const db = makeDb([{ match: 'FROM memory', first: { encrypted_facts: blob, incognito: 0 } }]);
    const result = await handleCommand('/memory', '', phone, db, env);
    expect(result).toContain('1. Likes tea');
    expect(result).toContain('2. Has a cat');
  });

  it('toggles incognito and reuses or creates placeholder blobs', async () => {
    const existingBlob = await encryptMessage(phone, '[]', env.ENCRYPTION_KEY, 'memory');
    const existing = makeDb([{ match: 'FROM memory', first: { encrypted_facts: existingBlob } }, { match: 'INSERT INTO memory' }]);
    await handleCommand('/memory', 'incognito on', phone, existing, env);
    expect(existing.calls[1].args).toEqual([phone, existingBlob, 1]);
    const fresh = makeDb([{ match: 'FROM memory', first: null }, { match: 'INSERT INTO memory' }]);
    await handleCommand('/memory', 'incognito off', phone, fresh, env);
    expect(fresh.calls[1].args[0]).toBe(phone);
    expect(await decryptMessage(phone, fresh.calls[1].args[1], env.ENCRYPTION_KEY, 'memory')).toBe('[]');
    expect(fresh.calls[1].args[2]).toBe(0);
  });

  it('adds facts with validation, incognito protection, and an eight-fact cap', async () => {
    // "add" lacks the trailing space required by the prefix check, so it falls through to the view path; the prompt branch is unreachable through handleCommand because args are pre-trimmed.
    expect(await handleCommand('/memory', 'add', phone, makeDb([{ match: 'FROM memory', first: null }]), env)).toContain("don't have any stored memory");
    expect(await handleCommand('/memory', `add ${'x'.repeat(201)}`, phone, makeDb(), env)).toContain('too long');
    const paused = makeDb([{ match: 'FROM memory', first: { incognito: 1 } }]);
    expect(await handleCommand('/memory', 'add x', phone, paused, env)).toContain('incognito mode');
    const facts = Array.from({ length: 8 }, (_, i) => `fact-${i}`);
    const blob = await encryptMessage(phone, JSON.stringify(facts), env.ENCRYPTION_KEY, 'memory');
    const db = makeDb([{ match: 'FROM memory', first: { encrypted_facts: blob, last_extracted_message_count: 5 } }, { match: 'INSERT INTO memory' }]);
    await handleCommand('/memory', 'add fact-8', phone, db, env);
    const saved = await decryptMessage(phone, db.calls[1].args[1], env.ENCRYPTION_KEY, 'memory');
    expect(JSON.parse(saved)).toEqual([...facts.slice(1), 'fact-8']);
  });

  it('treats corrupt memory as empty and forgets rows', async () => {
    const blob = await encryptMessage(phone, 'not json', env.ENCRYPTION_KEY, 'memory');
    const db = makeDb([{ match: 'FROM memory', first: { encrypted_facts: blob } }, { match: 'INSERT INTO memory' }]);
    await expect(handleCommand('/memory', 'add new fact', phone, db, env)).resolves.toContain('Added');
    const row = makeDb([{ match: 'FROM memory', first: { encrypted_facts: blob } }, { match: 'DELETE FROM memory' }]);
    expect(await handleCommand('/forget-memory', '', phone, row, env)).toContain('erased');
    expect(row.calls[1].args).toEqual([phone]);
  });
});
