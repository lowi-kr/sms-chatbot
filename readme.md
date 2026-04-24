# SMS AI Chatbot
Powered by Gemini AI + Telnyx + Cloudflare Workers + D1 + Google Sheets

---

## Features
- 💬 Full conversational memory (entire conversation history)
- 📁 Save, rename, load, and delete conversations via slash commands
- 🛡️ Content filtering (keyword + Gemini safety filters)
- 📊 Logs all conversations to Google Sheets
- ✅ Whitelist: only allow specific numbers
- 🚫 Blacklist: block specific numbers
- 📱 SMS & MMS support via Telnyx

---

## Setup Guide

### Step 1: Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```

### Step 2: Clone and install
```bash
cd sms-chatbot
npm install
```

### Step 3: Create D1 Database
```bash
npm run db:create
```
Copy the `database_id` from the output and paste it into `wrangler.toml` replacing `YOUR_D1_DATABASE_ID`.

### Step 4: Initialize the database schema
```bash
# For local dev:
npm run db:init

# For production:
npm run db:init:remote
```

### Step 5: Set your secrets
Run these commands one by one — Wrangler will prompt you to paste the value:

```bash
# Your Telnyx API v2 key (from Mission Control Portal > Auth > Auth v2)
wrangler secret put TELNYX_API_KEY

# Your Telnyx phone number in E.164 format e.g. +19294480731
wrangler secret put TELNYX_PHONE_NUMBER

# Your Gemini API key (from aistudio.google.com)
wrangler secret put GEMINI_API_KEY

# Google Sheets ID (the long string in your sheet URL)
wrangler secret put GOOGLE_SHEETS_ID

# Google Service Account email
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL

# Google Service Account private key (the full -----BEGIN PRIVATE KEY----- ... block)
wrangler secret put GOOGLE_PRIVATE_KEY
```

### Step 6: Deploy
```bash
npm run deploy
```
Copy the Worker URL from the output (e.g. `https://sms-chatbot.YOUR-NAME.workers.dev`)

### Step 7: Set Webhook in Telnyx
1. Go to Telnyx Mission Control Portal
2. Go to Messaging > Messaging Profiles
3. Click your profile
4. Set **Inbound webhook URL** to: `https://sms-chatbot.YOUR-NAME.workers.dev/webhook`
5. Save

---

## Google Sheets Setup

1. Create a new Google Sheet
2. Rename the first sheet tab to **Logs**
3. Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
4. Go to [Google Cloud Console](https://console.cloud.google.com)
5. Create a new project (or use existing)
6. Enable **Google Sheets API**
7. Go to IAM > Service Accounts > Create Service Account
8. Give it a name, click Create
9. Click on the service account > Keys > Add Key > JSON
10. Download the JSON file
11. From the JSON file, copy:
    - `client_email` → use as `GOOGLE_SERVICE_ACCOUNT_EMAIL`
    - `private_key` → use as `GOOGLE_PRIVATE_KEY`
12. Share your Google Sheet with the service account email (give it Editor access)

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
| `/help` | Show all commands |

---

## Whitelist / Blacklist Management

Manage directly via D1 console or Wrangler:

```bash
# Add to whitelist
wrangler d1 execute sms-chatbot-db --remote --command="INSERT INTO whitelist (phone_number, label) VALUES ('+1234567890', 'My number')"

# Add to blacklist
wrangler d1 execute sms-chatbot-db --remote --command="INSERT INTO blacklist (phone_number, reason) VALUES ('+1234567890', 'Spam')"

# View whitelist
wrangler d1 execute sms-chatbot-db --remote --command="SELECT * FROM whitelist"

# View blacklist
wrangler d1 execute sms-chatbot-db --remote --command="SELECT * FROM blacklist"

# Remove from blacklist
wrangler d1 execute sms-chatbot-db --remote --command="DELETE FROM blacklist WHERE phone_number='+1234567890'"
```

**Note:** If the whitelist is empty, ALL numbers can use the bot (except blacklisted ones).
If the whitelist has ANY entries, ONLY those numbers can use the bot.

---

## Local Development

```bash
npm run dev
```
Use [ngrok](https://ngrok.com) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose localhost for webhook testing.

## View Live Logs
```bash
npm run tail
```
