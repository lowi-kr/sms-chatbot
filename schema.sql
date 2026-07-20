-- SMS Chatbot Database Schema
-- Run this with: wrangler d1 execute sms-chatbot-db --file=schema.sql

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_number TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'New Conversation',
  is_active INTEGER NOT NULL DEFAULT 1,
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

-- Settings table (key/value store for runtime-configurable options)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Default AI model (OpenRouter slug) - dashboard-editable
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'openrouter/free');

-- Per-number encrypted memory (durable facts extracted from conversation history).
-- encrypted_facts is a JSON array of short strings, AES-256-GCM encrypted with a
-- key derived the same way as `messages` (see src/crypto.js) but with a distinct
-- HKDF "purpose" (info string) so the memory key and message key are cryptographically
-- independent even though they share the same ENCRYPTION_KEY pepper. Never readable
-- server-side without ENCRYPTION_KEY, which the admin-api worker never holds.
CREATE TABLE IF NOT EXISTS memory (
  phone_number TEXT PRIMARY KEY,
  encrypted_facts TEXT NOT NULL,
  last_extracted_message_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Memory extraction settings (mirrors the naming_model / ai_model settings pattern)
INSERT OR IGNORE INTO settings (key, value) VALUES ('memory_model', 'meta-llama/llama-3.1-8b-instruct:free');
INSERT OR IGNORE INTO settings (key, value) VALUES ('memory_extraction_threshold', '10');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations(phone_number, is_active);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);