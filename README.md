# SMS AI Chatbot

> Encrypted, conversational SMS AI powered by Telnyx, Cloudflare Workers, OpenRouter, and D1.

[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://workers.cloudflare.com/) [![Telnyx](https://img.shields.io/badge/SMS-Telnyx-00a3e0)](https://telnyx.com/) [![OpenRouter](https://img.shields.io/badge/AI-OpenRouter-111827)](https://openrouter.ai/) [![License](https://img.shields.io/badge/license-see%20repository-lightgrey)](LICENSE)

SMS Chatbot turns ordinary texting into a private AI conversation. Messages and durable per-contact memory are encrypted before storage, while Cloudflare D1 provides the durable SQLite-backed data layer. Telnyx handles SMS/MMS delivery and OpenRouter provides configurable AI models.

The companion administration UI is [sms-chatbot-dashboard](https://github.com/lowi-kr/sms-chatbot-dashboard), a separate static dashboard for contacts, support, access lists, model settings, usage, and outbound messages.

## Highlights

- Encrypted conversation history and per-number memory with AES-256-GCM and HKDF
- Conversational memory, auto-naming, model overrides, fallbacks, and token limits
- SMS and MMS inbound/outbound messaging through Telnyx
- OpenRouter chat, naming, and memory-extraction models
- Whitelist, blacklist, keyword filtering, and a plaintext support-ticket queue
- Admin API for the companion dashboard
- Google Sheets metadata logging without ordinary message content
- Browser-based `/test-ui` console for testing without a phone or Telnyx

## Architecture

```text
Telnyx SMS/MMS → Cloudflare Worker → access/filtering → encrypted D1 history
                                      ↓
                                  OpenRouter
                                      ↓
                              Telnyx response
                                      ↓
                         Google Sheets metadata log

Dashboard → Worker /api/* → administration and settings
```

| Component | Responsibility |
|---|---|
| Cloudflare Worker | Webhook, message pipeline, AI orchestration, and admin API |
| Cloudflare D1 | Conversations, encrypted messages/memory, settings, access lists, tickets, usage |
| Telnyx | SMS/MMS transport |
| OpenRouter | Chat completions, naming, and memory extraction |
| Google Sheets | Conversation metadata and moderation logging |
| GitHub | Source control and automated deployment |

## Slash commands

Send these commands by SMS:

| Command | Description |
|---|---|
| `/new` | Start a fresh conversation |
| `/save [name]` | Save/name the current conversation |
| `/rename [name]` | Rename the current conversation |
| `/rename [id] [name]` | Rename a conversation by ID |
| `/list` | List conversations |
| `/load [id]` | Switch conversations |
| `/delete [id]` | Delete a conversation |
| `/support [message]` | Create a plaintext support ticket |
| `/memory` | View remembered facts |
| `/memory add [fact]` | Add a fact manually |
| `/memory incognito on\|off` | Pause or resume memory read/write |
| `/forget-memory` | Erase stored memory and reset incognito |
| `/help` | Show available commands |

## Setup

Deployment is designed to work from GitHub.dev and the Cloudflare dashboard, with optional Wrangler commands. The complete guide covers repository deployment, Pages/Workers, D1 creation and schema initialization, bindings, Wrangler configuration, secrets, browser encryption-key generation, Google Sheets, Telnyx webhooks, TEST_MODE, and administration.

→ [Read the complete setup guide](SETUP.md)

## Privacy and security

- Message and memory ciphertext is stored using AES-256-GCM with per-phone HKDF-derived keys.
- Messages and memory use independent HKDF purpose strings (`msg` and `memory`).
- The admin API does not decrypt or expose conversation content; support tickets are intentionally plaintext for human follow-up.
- Google Sheets receives metadata such as timestamps, roles, lengths, models, and token counts. Filtered/blocked content is the moderation exception and is logged in full.
- `ENCRYPTION_KEY` is critical key material: losing or rotating it makes existing ciphertext unreadable. Store it securely and never commit it.

## Testing and administration

Set `TEST_MODE = "true"` in `wrangler.toml` and redeploy to enable `/test` and `/test-ui`. Replies are logged instead of sent through Telnyx, making it safe to test models in a browser. Remove the variable and redeploy for live SMS delivery.

Use the [dashboard](https://github.com/lowi-kr/sms-chatbot-dashboard) for whitelist/blacklist management, model and fallback settings, token limits, usage, support tickets, and admin-sent SMS. Cloudflare Worker runtime logs are available in the Worker Logs tab; metadata appears in the configured Google Sheet.

## Repository layout

```text
src/index.js                    Worker router and entry point
src/core/                       Message pipeline, delivery, naming, memory extraction
src/db/                         D1 access helpers
src/handlers/                   Telnyx webhook and test routes
src/integrations/               Telnyx, Sheets, and OpenRouter providers
src/security/                   Encryption and content filtering
src/commands/                   Slash-command handling
src/admin/                      Dashboard-facing API
src/ui/                         Test console HTML
schema.sql                      D1 schema and indexes
wrangler.toml                   Worker, vars, and D1 binding configuration
SETUP.md                        Detailed deployment guide
```

## Development

```bash
npm install
npm run dev
npm run deploy
npm run db:create
npm run db:init
npm run db:init:remote
npm run tail
```

See [SETUP.md](SETUP.md) for configuration details and operational cautions.