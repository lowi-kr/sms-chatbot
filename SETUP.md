# Setup and Deployment

This guide deploys the SMS chatbot as a Cloudflare Worker with D1, Telnyx, OpenRouter, and optional Google Sheets logging. The workflow can be completed in a browser; Wrangler commands are included for local or CI workflows.

## Prerequisites

You need a Cloudflare account, Telnyx account and SMS-capable number, OpenRouter API key, and (for metadata logging) a Google Cloud project with Sheets API enabled. The companion dashboard is [sms-chatbot-dashboard](https://github.com/lowi-kr/sms-chatbot-dashboard); it is deployed separately and calls this worker's `/api/*` endpoints.

## 1. Repository and Cloudflare deployment

1. Fork the repository to your own GitHub account.
2. Open your fork on GitHub. Use GitHub.dev by pressing `.`, or clone it locally.
3. Confirm your fork contains `src/`, `schema.sql`, `wrangler.toml`, and `package.json`.
4. Commit and push changes to `main` (or the branch configured in Cloudflare).
5. In Cloudflare, open Workers & Pages → Create application → Workers → Connect to Git, select your fork, and authorize GitHub.
6. Use the Worker deployment settings appropriate for this repository, with `src/index.js` as the entry point. Save and deploy.
7. Cloudflare will redeploy after pushes. This is a Cloudflare Worker deployment, not a Pages deployment.

## 2. Create and initialize D1

### Dashboard UI approach

1. Open Cloudflare Dashboard → Workers & Pages → D1 → Create database.
2. Name it `sms-chatbot-db` and copy the generated Database ID.
3. Open the database's Console tab, paste the complete contents of `schema.sql`, and execute it.
4. Verify tables include `conversations`, `messages`, `settings`, `memory`, `support_tickets`, `number_settings`, `whitelist`, and `blacklist`.

### CLI approach (Wrangler)

```bash
npm install
npx wrangler d1 create sms-chatbot-db
npx wrangler d1 execute sms-chatbot-db --file=schema.sql --remote
```

Use `--local` instead of `--remote` for a local development database. The package aliases are `npm run db:create`, `npm run db:init`, and `npm run db:init:remote`.

The schema creates indexes and default settings, including the free OpenRouter model, `block` as the default fallback, naming and memory models, and a memory extraction threshold of 10 messages. Do not omit `support_tickets` or `number_settings`; the support and per-number settings APIs depend on them.

## 3. Configure the D1 binding and environment variables

### CLI approach (Wrangler configuration)

Edit `wrangler.toml` and set the ID returned by D1:

```toml
name = "sms-chatbot"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
WORKER_URL = "https://sms-chatbot.YOUR-NAME.workers.dev"
# TEST_MODE = "true"
# ADMIN_ALLOWED_ORIGINS = "https://dashboard.example.com,https://admin.example.com"

[[d1_databases]]
binding = "DB"
database_name = "sms-chatbot-db"
database_id = "YOUR-D1-DATABASE-ID"
```

Keep the binding name exactly `DB`. `WORKER_URL` is used for OpenRouter attribution and is not secret. `TEST_MODE` and `ADMIN_ALLOWED_ORIGINS` are non-secret environment variables; keep them in `[vars]` when enabled. Commit and push the updated file, then confirm deployment succeeds.

### Dashboard UI approach

1. Open Workers & Pages → select the deployed `sms-chatbot` Worker → Settings → Bindings.
2. Choose Add binding → D1 database, set the variable/binding name to exactly `DB`, select `sms-chatbot-db`, and save.
3. Open Settings → Variables and Secrets → Environment Variables, choose the appropriate environment (Production, and Preview if used), and add `WORKER_URL` with the Worker URL.
4. To enable browser testing, add `TEST_MODE` with the value `true`. To return to live delivery, remove it or change it to `false`.
5. Save and deploy/redeploy the Worker. Confirm the binding and variables are present in the selected environment.

If the Worker is connected to Git and `wrangler.toml` declares the binding or `[vars]`, treat that file as the source of truth: update it and push a commit so a later deployment does not overwrite Dashboard-only settings. Dashboard bindings and variables must be configured separately for each environment when applicable.

## 4. Add encrypted secrets

### Dashboard UI approach

1. Open Workers & Pages → select the Worker → Settings → Variables and Secrets.
2. Under the target environment, choose Add variable, enter each name/value below, select Encrypt/Secret for sensitive values, and save. Deploy or redeploy after saving.

| Secret | Value |
|---|---|
| `TELNYX_API_KEY` | Telnyx Mission Control → Auth v2 API key |
| `TELNYX_PHONE_NUMBER` | Telnyx number in E.164 form, such as `+14087566645` |
| `TELNYX_PUBLIC_KEY` | Required: Public Key for the messaging profile/app in the Telnyx portal; used to verify webhook signatures |
| `OPENROUTER_API_KEY` | OpenRouter → Keys |
| `ENCRYPTION_KEY` | Exactly 32 random bytes represented as 64 hexadecimal characters |
| `ADMIN_SECRET` | Long, unique dashboard/API password |
| `GOOGLE_SHEETS_ID` | Spreadsheet ID in its URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from service-account JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` from service-account JSON, preserving line breaks or escaped newlines as required |

When editing an existing secret, use its Edit/Replace control; Cloudflare does not reveal the old encrypted value. Add the secrets in both Production and Preview only if both environments need them. Never put secrets in `wrangler.toml` or commit them.

### CLI approach (Wrangler)

Use Wrangler's secret prompt for each secret; it keeps the value out of the command line and shell history:

```bash
npx wrangler secret put TELNYX_API_KEY
npx wrangler secret put TELNYX_PHONE_NUMBER
npx wrangler secret put TELNYX_PUBLIC_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put GOOGLE_SHEETS_ID
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
```

Run the commands from the repository so Wrangler uses the intended Worker configuration. For a non-production environment, pass the appropriate Wrangler environment option and configure that environment's binding/variables as well.

Never commit secrets. `ENCRYPTION_KEY` is the pepper used to derive per-phone keys for messages and memory. Losing it or rotating it makes previously stored encrypted data permanently unreadable, so keep a secure backup.

### Generate ENCRYPTION_KEY with DevTools

1. Open any page in Chrome, Firefox, or Edge.
2. Open DevTools (F12; macOS: Cmd+Option+I) and select Console.
3. Paste and run:

```js
[...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
```

4. Copy the resulting 64-character hexadecimal string exactly into the encrypted secret and store it in a password manager.

## 5. Configure Google Sheets logging

1. Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable the Google Sheets API.
3. Create a Service Account and generate a JSON key.
4. Create a spreadsheet and rename its first tab `Logs`.
5. Share the spreadsheet with the service account's `client_email` as Editor.
6. Put the spreadsheet ID, service-account email, and private key into the three Cloudflare secrets above.

The worker logs timestamp, phone number, conversation name, role, message length, model, and token counts. Ordinary message content is not written to Sheets. Filtered or blocked messages are logged in full for moderation review and appear as bold red rows.

## 6. Configure Telnyx

1. Buy or select an SMS-capable Telnyx number.
2. Create an API key under Mission Control → Auth v2.
3. Open Messaging → Messaging Profiles and select the profile assigned to the number.
4. Set the Inbound Webhook URL to:

```text
https://sms-chatbot.YOUR-NAME.workers.dev/webhook
```

5. Save the profile and ensure the number is assigned to it. Send a test SMS and inspect Cloudflare Worker logs if delivery does not occur.

## 7. TEST_MODE and browser testing

### CLI approach

Set this in `wrangler.toml` and redeploy:

```toml
[vars]
TEST_MODE = "true"
# ADMIN_ALLOWED_ORIGINS = "https://dashboard.example.com,https://admin.example.com"
```

Commit and push the file, or run the deployment command used by your repository.

### Dashboard UI approach

In the Worker, open Settings → Variables and Secrets → Environment Variables, add or edit `TEST_MODE`, set it to `true`, save, and deploy. Remove it or set it to `false` and redeploy for live Telnyx delivery.

With `TEST_MODE = "true"`, AI replies are printed to Worker logs instead of sent through Telnyx, and test routes are enabled. Open `https://sms-chatbot.YOUR-NAME.workers.dev/test-ui`. The `/test` endpoint used by `/test-ui` requires the `ADMIN_SECRET` password; the console prompts for it. It lets you select an OpenRouter model per message. Do not leave test mode enabled in production if you expect SMS delivery.

## 8. Dashboard and administration

Deploy the companion dashboard repository as its own static site, configure its worker base URL and `ADMIN_SECRET` according to that repository's instructions, and use it for contacts, conversation metadata, support tickets, whitelist/blacklist, model settings, usage, and admin-sent SMS. The worker authenticates `/api/*` with `ADMIN_SECRET`.

If needed, use the D1 Console:

```sql
INSERT INTO blacklist (phone_number, reason) VALUES ('+1234567890', 'Spam');
INSERT INTO whitelist (phone_number, label) VALUES ('+1234567890', 'My number');
```

An empty whitelist permits all non-blacklisted numbers. Once it contains entries, only whitelisted numbers can use the bot.

## 9. Useful development commands

```bash
npm install
npm run dev
npm run deploy
npm run db:create
npm run db:init
npm run db:init:remote
npm run tail
```

Use `wrangler dev` locally and `wrangler tail` or Cloudflare Dashboard → Workers & Pages → your worker → Logs for diagnostics. Git deployments normally update within about a minute.

## Security notes

Messages are stored at rest with AES-256-GCM using a per-phone HKDF-derived key. Memory facts use a separate purpose string (`memory`) from messages (`msg`). Admin code deliberately does not expose decrypted conversation messages; support tickets are the plaintext exception. Sheets receives metadata, except moderation content for blocked/filtered messages. A public repository is appropriate for this GPL-3.0-licensed project; restrict Cloudflare and Telnyx access, and do not rotate `ENCRYPTION_KEY` unless intentionally abandoning existing ciphertext.
