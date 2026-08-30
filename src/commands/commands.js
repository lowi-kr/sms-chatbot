// commands.js - Handles all slash commands

import {
  getMemoryRow, saveMemoryRow, setMemoryIncognitoFlag, deleteMemory,
  startNewConversation, switchActiveConversation, getOwnedConversation,
  listConversations, countConversationMessages, deleteConversation,
  renameActiveConversation, renameOwnedConversation, createSupportTicket,
} from '../db/index.js';
import {
  MAX_FACT_LENGTH, decryptFactsChecked, encryptFacts, normalizeFacts,
} from '../core/memoryFacts.js';

// env is required for memory commands (ENCRYPTION_KEY) — every other command
// ignores it, so existing callers that only had (command, args, phoneNumber, db)
// must be updated to also pass env (see core/processMessage.js).
export async function handleCommand(command, args, phoneNumber, db, env) {
  const cmd = command.toLowerCase();

  switch (cmd) {
    case '/new':
      return await cmdNew(phoneNumber, db);
    case '/save':
      return await cmdSave(phoneNumber, args, db);
    case '/rename':
      return await cmdRename(phoneNumber, args, db);
    case '/list':
      return await cmdList(phoneNumber, db);
    case '/load':
      return await cmdLoad(phoneNumber, args, db);
    case '/delete':
      return await cmdDelete(phoneNumber, args, db);
    case '/support':
      return await cmdSupport(phoneNumber, args, db);
    case '/memory':
      return await cmdMemory(phoneNumber, args, db, env);
    case '/forget-memory':
      return await cmdForgetMemory(phoneNumber, db, env);
    case '/help':
      return cmdHelp();
    default:
      return `Unknown command: ${command}. Text /help for a list of commands.`;
  }
}

export function parseCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();
  return { command, args };
}

async function cmdNew(phoneNumber, db) {
  const conv = await startNewConversation(db, phoneNumber);
  return `✨ Started a new conversation! (ID: ${conv.id})\nText /save [name] to give it a name, or just start chatting!`;
}

async function cmdSave(phoneNumber, name, db) {
  if (!name) return `Please provide a name. Example: /save My Recipe Chat`;

  const changed = await renameActiveConversation(db, phoneNumber, name);
  if (!changed) return `No active conversation found. Text /new to start one.`;
  return `✅ Conversation saved as "${name}"`;
}

async function cmdRename(phoneNumber, args, db) {
  const parts = args.split(' ');
  const firstWord = parts[0];
  const isId = /^\d+$/.test(firstWord);

  if (isId) {
    const id = parseInt(firstWord);
    const name = parts.slice(1).join(' ').trim();
    if (!name) return `Please provide a new name. Example: /rename ${id} My Chat`;

    const changed = await renameOwnedConversation(db, id, phoneNumber, name);
    if (!changed) return `Conversation #${id} not found.`;
    return `✅ Renamed to "${name}"`;
  } else {
    const name = args;
    if (!name) return `Please provide a name. Example: /rename My Chat`;

    const changed = await renameActiveConversation(db, phoneNumber, name);
    if (!changed) return `No active conversation found.`;
    return `✅ Renamed to "${name}"`;
  }
}

async function cmdList(phoneNumber, db) {
  const results = await listConversations(db, phoneNumber);

  if (!results.length) return `No conversations found. Start chatting or text /new!`;

  let response = `📋 Your conversations:\n\n`;
  for (const conv of results) {
    const active = conv.is_active ? ' ← active' : '';
    const date = new Date(conv.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    response += `#${conv.id} ${conv.name}${active}\n   ${conv.msg_count} messages · ${date}\n\n`;
  }
  response += `Text /load [id] to switch conversations.`;
  return response.trim();
}

async function cmdLoad(phoneNumber, args, db) {
  const id = parseInt(args);
  if (!id) return `Please provide a conversation ID. Example: /load 3\nText /list to see your conversations.`;

  const conv = await getOwnedConversation(db, id, phoneNumber);
  if (!conv) return `Conversation #${id} not found. Text /list to see your conversations.`;

  await switchActiveConversation(db, phoneNumber, id);
  const count = await countConversationMessages(db, id);

  return `✅ Loaded "${conv.name}" (${count} messages). Continue where you left off!`;
}

async function cmdDelete(phoneNumber, args, db) {
  const id = parseInt(args);
  if (!id) return `Please provide a conversation ID. Example: /delete 3\nText /list to see your conversations.`;

  const conv = await getOwnedConversation(db, id, phoneNumber);
  if (!conv) return `Conversation #${id} not found.`;

  await deleteConversation(db, id);

  if (conv.is_active) {
    await startNewConversation(db, phoneNumber);
    return `🗑️ Deleted "${conv.name}" and started a new conversation.`;
  }

  return `🗑️ Deleted "${conv.name}".`;
}

async function cmdSupport(phoneNumber, args, db) {
  if (!args || !args.trim()) {
    return `Please include your message. Example: /support I can't load my conversation`;
  }

  await createSupportTicket(db, phoneNumber, args.trim());

  return `✅ Your message has been received by the support team. We'll get back to you shortly!`;
}

// ---------------------------------------------------------------
// Memory commands
// ---------------------------------------------------------------
// All memory read/write in this file goes through core/memoryFacts.js — the same
// encryption boundary (purpose='memory') and fact limits core/memoryExtraction.js
// uses for background extraction. Nothing here is ever exposed to the admin API,
// which never holds ENCRYPTION_KEY.
//
// Unlike processMessage.js/memoryExtraction.js (best-effort, silently proceed
// without memory on any failure), the commands below are directly user-facing —
// so they use decryptFactsChecked() and explicitly tell the person when their
// stored memory is corrupted rather than silently acting like it's empty. This
// also matters for /memory add: if we couldn't confirm what's already stored,
// we refuse to write rather than risk silently overwriting a corrupted blob
// with a fresh array containing only the new fact.

async function cmdMemory(phoneNumber, args, db, env) {
  if (!env?.ENCRYPTION_KEY) {
    return `Memory isn't configured on this bot (no encryption key set). Contact the admin.`;
  }

  const trimmed = (args || '').trim();
  const lower = trimmed.toLowerCase();

  // /memory incognito on|off — pauses BOTH injection and extraction for this number
  if (lower === 'incognito on' || lower === 'incognito off') {
    const enabling = lower === 'incognito on';
    const existing = await getMemoryRow(db, phoneNumber);
    // Row requires encrypted_facts NOT NULL — reuse existing blob, or seed an empty one.
    const placeholderFacts = existing?.encrypted_facts
      || await encryptFacts(phoneNumber, [], env.ENCRYPTION_KEY);
    await setMemoryIncognitoFlag(db, phoneNumber, enabling, placeholderFacts);

    return enabling
      ? `🕶️ Incognito mode ON. I won't read or update memory for this number until you text /memory incognito off.`
      : `✅ Incognito mode OFF. Memory will be used and updated normally again.`;
  }

  // /memory add [fact]
  if (lower.startsWith('add ')) {
    const fact = trimmed.slice(4).trim();
    if (!fact) return `Please include a fact. Example: /memory add I have a dog named Max`;
    if (fact.length > MAX_FACT_LENGTH) return `That's too long — please keep facts under ${MAX_FACT_LENGTH} characters.`;

    const row = await getMemoryRow(db, phoneNumber);
    if (row?.incognito) {
      return `You're in incognito mode. Text /memory incognito off first to manage memory.`;
    }

    const { facts: stored, corrupted } = await decryptFactsChecked(phoneNumber, row?.encrypted_facts, env.ENCRYPTION_KEY);
    if (corrupted) {
      return `I couldn't read your stored memory — it may be corrupted. Text /forget-memory to reset it.`;
    }

    const facts = normalizeFacts([...stored, fact]);

    const encrypted = await encryptFacts(phoneNumber, facts, env.ENCRYPTION_KEY);
    const lastCount = row?.last_extracted_message_count || 0;
    await saveMemoryRow(db, phoneNumber, encrypted, lastCount);

    return `✅ Added to memory: "${fact}"`;
  }

  // Default (no args, or unrecognized args): view current facts
  const row = await getMemoryRow(db, phoneNumber);

  if (row?.incognito) {
    return `🕶️ Incognito mode is ON — memory is paused. Text /memory incognito off to resume.`;
  }

  if (!row || !row.encrypted_facts) {
    return `I don't have any stored memory for this number yet.\n\nText /memory add [fact] to add one manually, or just keep chatting — I'll pick things up automatically.`;
  }

  const { facts, corrupted } = await decryptFactsChecked(phoneNumber, row.encrypted_facts, env.ENCRYPTION_KEY);

  if (corrupted) {
    return `I couldn't read your stored memory — it may be corrupted. Text /forget-memory to reset it.`;
  }

  if (!facts.length) {
    return `I don't have any stored memory for this number yet.\n\nText /memory add [fact] to add one manually.`;
  }

  const list = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return `🧠 What I remember about you:\n\n${list}\n\nText /forget-memory to erase this, or /memory incognito on to pause memory.`;
}

async function cmdForgetMemory(phoneNumber, db, env) {
  if (!env?.ENCRYPTION_KEY) {
    return `Memory isn't configured on this bot (no encryption key set). Contact the admin.`;
  }

  const row = await getMemoryRow(db, phoneNumber);
  if (!row) {
    return `There's nothing stored to forget.`;
  }

  await deleteMemory(db, phoneNumber);
  return `🗑️ Memory erased. I'll start fresh from here. (This also clears incognito mode, if it was on.)`;
}

function cmdHelp() {
  return `🤖 SMS Chatbot Commands:

/new — Start a new conversation
/save [name] — Save/name current chat
/rename [name] — Rename current chat
/rename [id] [name] — Rename any chat
/list — See all your conversations
/load [id] — Switch to a conversation
/delete [id] — Delete a conversation
/support [message] — Contact support
/memory — See what I remember about you
/memory add [fact] — Add something to remember
/memory incognito on|off — Pause/resume memory
/forget-memory — Erase everything I remember
/help — Show this message

Just text normally to chat with AI!`;
  }
