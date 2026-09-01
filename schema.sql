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

-- Added for feature-byok: global default for the web search quick-win toggle.
-- '1' = append web search (OpenRouter :online / plugins) to requests by default.
INSERT OR IGNORE INTO settings (key, value) VALUES ('web_search_enabled', '0');

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

-- ---------------------------------------------------------------
-- feature-byok additions below. All additive — no existing columns
-- or tables are altered in a breaking way.
-- ---------------------------------------------------------------

-- Per-number web search override. NULL = inherit the global 'web_search_enabled'
-- setting above. 0/1 = explicit override for this number.
--
-- ⚠️ UNLIKE every other statement in this file, this ALTER TABLE is NOT safe
-- to re-run — SQLite/D1 has no "ADD COLUMN IF NOT EXISTS", so running this a
-- second time against a database that already has the column will throw
-- "duplicate column name: web_search" and abort the whole script.
-- If you're running this schema.sql fresh against a brand-new D1 database,
-- leave it here — it'll apply once, cleanly. If you're applying this diff to
-- your EXISTING production database that already ran the old schema.sql, run
-- ONLY this one line by itself in the D1 Console instead of re-running the
-- whole file:
--   ALTER TABLE number_settings ADD COLUMN web_search INTEGER;
ALTER TABLE number_settings ADD COLUMN web_search INTEGER;

-- Data-driven provider registry. Adding a new provider later is a data change
-- (INSERT a row + write one adapter file if its request/response shape is new),
-- not a hardcoded enum change.
--   auth_style   - how the API key is attached to the outbound request
--   adapter      - which adapter module in src/integrations/providers/adapters/
--                  knows how to build/parse requests for this provider
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_style TEXT NOT NULL CHECK(auth_style IN ('bearer', 'anthropic-header', 'google-query')),
  adapter TEXT NOT NULL CHECK(adapter IN ('openai-compatible', 'anthropic', 'google')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO providers (id, name, base_url, auth_style, adapter) VALUES
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', 'bearer', 'openai-compatible'),
  ('openai', 'OpenAI', 'https://api.openai.com/v1/chat/completions', 'bearer', 'openai-compatible'),
  ('anthropic', 'Anthropic', 'https://api.anthropic.com/v1/messages', 'anthropic-header', 'anthropic'),
  ('google', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/models', 'google-query', 'google');

-- Admin-only BYOK keys. api_key_encrypted uses the same HKDF pattern as
-- messages/memory in src/security/crypto.js, with purpose='provider-key' for
-- cryptographic separation. Encryption/decryption of this column must ONLY
-- happen in src/db/providerKeys.js (called from the main worker's provider
-- layer) — never from src/admin/* routes. See src/admin/providerKeys.js for
-- the narrow, explicit exception on the write path.
CREATE TABLE IF NOT EXISTS admin_provider_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  label TEXT,
  api_key_encrypted TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  priority_tier TEXT NOT NULL CHECK(priority_tier IN ('prioritized','backup')) DEFAULT 'prioritized',
  sort_order INTEGER NOT NULL DEFAULT 0,
  always_use INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- If a key has zero rows here, it is unrestricted (usable for any model on
-- its provider). If it has rows, it may only be used for the listed models.
CREATE TABLE IF NOT EXISTS provider_key_model_scope (
  provider_key_id INTEGER NOT NULL REFERENCES admin_provider_keys(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  PRIMARY KEY (provider_key_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(phone_number, is_active);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_phone ON support_tickets(phone_number);
CREATE INDEX IF NOT EXISTS idx_provider_keys_provider ON admin_provider_keys(provider_id, priority_tier, sort_order);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active ON admin_provider_keys(is_active);
