# SMS AI Chatbot

An SMS chatbot powered by OpenRouter (AI backend), Telnyx (SMS/MMS), Cloudflare Workers + D1, and Google Sheets — all built and deployed with zero local CLI, using GitHub.dev and the Cloudflare dashboard.

This is the **core bot worker**. For the companion admin dashboard (message logs, support tickets, whitelist/blacklist, model settings), see [`sms-chatbot-dashboard`](https://github.com/lowi-kr/sms-chatbot-dashboard) — it's a separate repo that reads/writes the same D1 database.

---

## Features

- 💬 Full conversational memory per contact, with save/rename/load/delete via slash commands
- 🔐 **End-to-end message encryption** (AES-256-GCM, per-phone key derivation) — conversation content is not readable server-side, even by the admin
- 🤖 AI responses via **OpenRouter**, with per-number model overrides, a per-number fallback model, and a `block` sentinel to cut off specific numbers
- 📊 Per-number lifetime token tracking (input/output tracked separately) with configurable limits
- 🛡️ Content filtering (keyword-based)
- ✅ Whitelist / 🚫 Blacklist number-level access control
- 🎫 `/support` command routes messages to a plaintext support-ticket queue (visible in the dashboard), separate from encrypted conversation history
- 🧪 Built-in `/test-ui` test console — chat with the bot directly in a browser, no Telnyx or phone number required
- 📁 Logs conversation **metadata** (not message content) to Google Sheets, including model used and token counts
- 📱 SMS & MMS support via Telnyx

---

## Tech Stack

| Service | Purpose |
|---|---|
| Cloudflare Workers | Webhook server / bot logic |
| Cloudflare D1 | SQLite database (shared with the admin API worker) |
| Telnyx | SMS/MMS sending and receiving |
| OpenRouter | AI responses (chat completions, OpenAI-compatible) |
| Google Sheets | Conversation metadata logging |
| GitHub | Code hosting + auto-deploy |

---

## File Structure

```
sms-chatbot/
├── src/
│   ├── index.js       # Worker entry point, webhook + /test + /test-ui routes
│   ├── commands.js     # Slash commands (/new, /save, /list, /support, etc.)
│   ├── openrouter.js    # OpenRouter API calls, model/fallback/limit resolution
│   ├── filter.js       # Keyword content filter + system prompt
│   ├── db.js           # D1 helpers (conversations, lists, per-number settings)
│   ├── crypto.js        # AES-256-GCM encryption / decryption
│   ├── sheets.js        # Google Sheets logging
│   └── testpage.js      # Standalone HTML test console served at /test-ui
├── schema.sql
├── wrangler.toml
├── package.json
└── README.md
```

---

## Setup Guide (100% Web-Based, No CLI Required)

### Step 1: Set Up the GitHub Repo

1. Create a new **private** GitHub repo named `sms-chatbot`.
2. Press `.` on the repo page to open **GitHub.dev** (browser VS Code).
3. Create the file structure above and paste in the contents of each file.
4. Commit via the **Source Control** panel → **Commit & Push**.

### Step 2: Create the Cloudflare D1 Database

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **D1** → **Create Database**.
2. Name it `sms-chatbot-db` and copy the **Database ID**.
3. Open the database → **Console** tab → paste the contents of `schema.sql` → **Execute**.

> ⚠️ This same database is shared with the `sms-chatbot-admin-api` worker from the dashboard repo — both bind to it.

### Step 3: Create the Worker

1. **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git** → select `sms-chatbot`.
2. Framework preset: **None**, build command and output directory: leave blank.
3. **Save and Deploy**. Cloudflare will now auto-deploy on every push to `main`.

### Step 4: Update `wrangler.toml`

Replace the `database_id` under `[[d1_databases]]` with the ID from Step 2, commit, and push.

> `wrangler.toml`'s `[vars]` section is also where `TEST_MODE` lives — variables set there **survive redeploys**, unlike variables set through the Cloudflare dashboard UI, which get wiped whenever `wrangler.toml` is present without them.

### Step 5: Set Secrets

Worker → **Settings** → **Variables** → add each as an **Encrypted** secret:

| Variable | Where to get it |
|---|---|
| `TELNYX_API_KEY` | Telnyx Mission Control → Auth v2 → Create Key |
| `TELNYX_PHONE_NUMBER` | Your Telnyx number, E.164 format, e.g. `+19294480731` |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) → Keys |
| `ENCRYPTION_KEY` | A random 32-byte hex string (64 hex characters) — **set only on this worker, never on the admin API worker**. This is the pepper used to derive per-phone encryption keys. Losing it makes all stored messages permanently unreadable. |
| `GOOGLE_SHEETS_ID` | The ID in your Google Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | From your Google Service Account JSON |
| `GOOGLE_PRIVATE_KEY` | From your Google Service Account JSON |

Optional Cloudflare **variable** (not secret), set in `wrangler.toml` `[vars]` so it survives deploys:

```toml
[vars]
TEST_MODE = "true"
```

When `TEST_MODE = "true"`, AI replies are logged to the console instead of sent via Telnyx, and the `/test` and `/test-ui` routes are enabled.

### Step 6: Set Up Google Sheets Logging

1. Create a spreadsheet, rename the first tab to **Logs**.
2. Copy the Sheet ID from the URL.
3. In [console.cloud.google.com](https://console.cloud.google.com), create a project, enable the **Google Sheets API**, and create a **Service Account** with a JSON key.
4. Copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY`.
5. Share the sheet with the service account email as **Editor**.

Only metadata is logged (timestamp, phone number, conversation name, role, message length, model used, token counts) — **message content is never written to Sheets**, except filtered/blocked messages, which are logged in full with a bold red row for moderation review.

### Step 7: Connect the Telnyx Webhook

Telnyx Mission Control → **Messaging** → **Messaging Profiles** → your profile → set **Inbound Webhook URL** to:

```
https://sms-chatbot.YOUR-NAME.workers.dev/webhook
```

---

## Slash Commands (send via SMS)

| Command | Description |
|---|---|
| `/new` | Start a fresh conversation |
| `/save [name]` | Name/save current conversation |
| `/rename [name]` | Rename current conversation |
| `/rename [id] [name]` | Rename any conversation by ID |
| `/list` | See all your conversations |
| `/load [id]` | Switch to a conversation |
| `/delete [id]` | Delete a conversation |
| `/support [message]` | Send a message to the support queue (plaintext, visible to admin) |
| `/help` | Show all commands |

---

## Testing Without a Phone Number

Set `TEST_MODE = "true"` in `wrangler.toml`, deploy, then open:

```
https://sms-chatbot.YOUR-NAME.workers.dev/test-ui
```

This serves a standalone chat console directly from the worker — no auth, no dashboard, no Telnyx. It talks to the worker's own `/test` endpoint and lets you pick a specific OpenRouter model per-message to try before pinning it in the dashboard.

---

## Managing Whitelist & Blacklist / Model Overrides

These are best managed from the **[sms-chatbot-dashboard](https://github.com/lowi-kr/sms-chatbot-dashboard)** UI (User Control and Model Settings pages). You can also run SQL directly in the D1 Console tab if needed:

```sql
-- Block a number
INSERT INTO blacklist (phone_number, reason) VALUES ('+1234567890', 'Spam');

-- Whitelist a number
INSERT INTO whitelist (phone_number, label) VALUES ('+1234567890', 'My number');
```

> If the whitelist is **empty**, all numbers can use the bot (except blacklisted ones). If it has **any** entries, only those numbers can.

---

## Privacy Architecture

- **Conversation messages** are encrypted at rest (AES-256-GCM, per-phone HKDF-derived key) — not readable server-side by anyone, including the admin.
- **Support ticket messages** (`/support`) are stored in plaintext and are visible in the dashboard, since they require human follow-up.
- **Admin-sent outbound SMS** are stored in plaintext in a separate table for the dashboard's conversation view.
- **Google Sheets** logs metadata only, except blocked/filtered messages, which are logged in full for moderation.

---

## Making Changes

1. Open the repo → press `.` for GitHub.dev.
2. Edit files, commit via the Source Control panel.
3. Cloudflare auto-deploys within ~1 minute.

---

## Viewing Logs

- **Conversation metadata:** your Google Sheet → Logs tab
- **Worker runtime logs:** Cloudflare Dashboard → Workers & Pages → this worker → **Logs** tab
- **Message content, support tickets, contacts:** the [dashboard](https://github.com/lowi-kr/sms-chatbot-dashboard)
