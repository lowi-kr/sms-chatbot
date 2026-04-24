// commands.js - Handles all slash commands

export async function handleCommand(command, args, phoneNumber, db) {
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
  // Deactivate current active conversation
  await db.prepare(
    `UPDATE conversations SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
     WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).run();

  // Create new conversation
  const name = `Conversation ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  const result = await db.prepare(
    `INSERT INTO conversations (phone_number, name, is_active) VALUES (?, ?, 1)`
  ).bind(phoneNumber, name).run();

  return `✨ Started a new conversation! (ID: ${result.meta.last_row_id})\nText /save [name] to give it a name, or just start chatting!`;
}

async function cmdSave(phoneNumber, name, db) {
  if (!name) return `Please provide a name. Example: /save My Recipe Chat`;

  const result = await db.prepare(
    `UPDATE conversations SET name = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE phone_number = ? AND is_active = 1`
  ).bind(name, phoneNumber).run();

  if (result.meta.changes === 0) return `No active conversation found. Text /new to start one.`;
  return `✅ Conversation saved as "${name}"`;
}

async function cmdRename(phoneNumber, args, db) {
  // Format: /rename [id] [new name] or /rename [new name] (renames current)
  const parts = args.split(' ');
  const firstWord = parts[0];
  const isId = /^\d+$/.test(firstWord);

  if (isId) {
    const id = parseInt(firstWord);
    const name = parts.slice(1).join(' ').trim();
    if (!name) return `Please provide a new name. Example: /rename ${id} My Chat`;

    const result = await db.prepare(
      `UPDATE conversations SET name = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND phone_number = ?`
    ).bind(name, id, phoneNumber).run();

    if (result.meta.changes === 0) return `Conversation #${id} not found.`;
    return `✅ Renamed to "${name}"`;
  } else {
    // Rename current conversation
    const name = args;
    if (!name) return `Please provide a name. Example: /rename My Chat`;

    const result = await db.prepare(
      `UPDATE conversations SET name = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE phone_number = ? AND is_active = 1`
    ).bind(name, phoneNumber).run();

    if (result.meta.changes === 0) return `No active conversation found.`;
    return `✅ Renamed to "${name}"`;
  }
}

async function cmdList(phoneNumber, db) {
  const { results } = await db.prepare(
    `SELECT id, name, is_active, updated_at,
     (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as msg_count
     FROM conversations 
     WHERE phone_number = ? 
     ORDER BY updated_at DESC 
     LIMIT 10`
  ).bind(phoneNumber).all();

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

  // Check conversation exists and belongs to this user
  const conv = await db.prepare(
    `SELECT id, name FROM conversations WHERE id = ? AND phone_number = ?`
  ).bind(id, phoneNumber).first();

  if (!conv) return `Conversation #${id} not found. Text /list to see your conversations.`;

  // Deactivate current
  await db.prepare(
    `UPDATE conversations SET is_active = 0, updated_at = CURRENT_TIMESTAMP 
     WHERE phone_number = ? AND is_active = 1`
  ).bind(phoneNumber).run();

  // Activate selected
  await db.prepare(
    `UPDATE conversations SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(id).run();

  // Get message count
  const { count } = await db.prepare(
    `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`
  ).bind(id).first();

  return `✅ Loaded "${conv.name}" (${count} messages). Continue where you left off!`;
}

async function cmdDelete(phoneNumber, args, db) {
  const id = parseInt(args);
  if (!id) return `Please provide a conversation ID. Example: /delete 3\nText /list to see your conversations.`;

  const conv = await db.prepare(
    `SELECT id, name, is_active FROM conversations WHERE id = ? AND phone_number = ?`
  ).bind(id, phoneNumber).first();

  if (!conv) return `Conversation #${id} not found.`;

  // Delete messages first
  await db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(id).run();

  // If it was active, create a new one
  if (conv.is_active) {
    await cmdNew(phoneNumber, db);
    return `🗑️ Deleted "${conv.name}" and started a new conversation.`;
  }

  return `🗑️ Deleted "${conv.name}".`;
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
/help — Show this message

Just text normally to chat with AI!`;
}
