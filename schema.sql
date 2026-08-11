CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'New Conversation',
  is_active INTEGER NOT NULL DEFAULT 1,
  is_named INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'openrouter/free');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_fallback_model', 'block');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_token_limit', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('naming_model', 'meta-llama/llama-3.1-8b-instruct:free');
INSERT OR IGNORE INTO settings (key, value) VALUES ('memory_model', 'meta-llama/llama-3.1-8b-instruct:free');
INSERT OR IGNORE INTO settings (key, value) VALUES ('memory_extraction_threshold', '10');

CREATE TABLE IF NOT EXISTS memory (
  phone_number TEXT PRIMARY KEY,
  encrypted_facts TEXT NOT NULL,
  last_extracted_message_count INTEGER NOT NULL DEFAULT 0,
  incognito INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Previously MISSING from schema.sql despite being used throughout
-- admin-api.js and src/commands/commands.js (cmdSupport). Any /support
-- command or dashboard Support page load would have thrown a D1
-- "no such table: support_tickets" error on a fresh database.
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

-- Previously MISSING from schema.sql despite being used throughout
-- admin-api.js and src/db/numbers.js. Any per-number model/fallback/limit
-- lookup or update (including the Model Settings dashboard page) would
-- have thrown a D1 "no such table: number_settings" error.
CREATE TABLE IF NOT EXISTS number_settings (
  phone_number TEXT PRIMARY KEY,
  model TEXT,
  fallback_model TEXT,
  token_limit INTEGER,
  tokens_input_used INTEGER NOT NULL DEFAULT 0,
  tokens_output_used INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(phone_number, is_active);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_phone ON support_tickets(phone_number);
