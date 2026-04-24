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

## Tech Stack
| Service | Purpose |
|---|---|
| Cloudflare Workers | Webhook server / bot logic |
| Cloudflare D1 | SQLite database for conversations |
| Telnyx | SMS/MMS sending and receiving |
| Gemini API | AI responses |
| Google Sheets | Conversation logging |
| GitHub | Code hosting + auto-deploy |

---

## Setup Guide (100% Web-Based, No CLI Required)

### Step 1: Set Up the GitHub Repo
1. Go to [github.com](https://github.com) and create a new **private** repo named `sms-chatbot`
2. Create a placeholder `README.md` file (required to activate the repo)
3. Press `.` on the repo page to open **GitHub.dev** (browser VS Code)
4. Create the following file structure by right-clicking in the Explorer panel:

```
sms-chatbot/
├── src/
│   ├── index.js
│   ├── commands.js
│   ├── gemini.js
│   ├── filter.js
│   ├── db.js
│   ├── sheets.js
│   └── telnyx.js
├── schema.sql
├── wrangler.toml
├── package.json
└── README.md
```

5. Paste the contents of each file from the project
6. Commit via the **Source Control** panel (branch icon in sidebar) → type a message → click **Commit & Push**

---

### Step 2: Create Cloudflare D1 Database
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages** in the left sidebar
3. Click **D1** → **Create Database**
4. Name it `sms-chatbot-db` and click **Create**
5. Copy the **Database ID** shown — you'll need this in the next step
6. Click on the database → go to the **Console** tab
7. Paste the entire contents of `schema.sql` and click **Execute**
8. You should see the tables created successfully

---

### Step 3: Create the Cloudflare Worker
1. In Cloudflare dashboard, go to **Workers & Pages**
2. Click **Create** → **Pages** tab → **Connect to Git**
3. Sign in with GitHub and select your `sms-chatbot` repo
4. Set these build settings:
   - **Framework preset:** None
   - **Build command:** leave blank
   - **Build output directory:** leave blank
5. Click **Save and Deploy**

> Cloudflare will now auto-deploy every time you push to GitHub!

---

### Step 4: Update wrangler.toml
1. Go back to GitHub.dev
2. Open `wrangler.toml`
3. Replace `YOUR_D1_DATABASE_ID` with the Database ID you copied in Step 2
4. Commit and push the change

---

### Step 5: Set Secrets in Cloudflare
1. Go to your Worker in the Cloudflare dashboard
2. Click **Settings** → **Variables**
3. Under **Environment Variables**, add each of these as **Encrypted** secrets:

| Variable | Where to get it |
|---|---|
| `TELNYX_API_KEY` | Telnyx Mission Control → Auth → Auth v2 → Create Key |
| `TELNYX_PHONE_NUMBER` | Your Telnyx number in E.164 format e.g. `+19294480731` |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API Key |
| `GOOGLE_SHEETS_ID` | The long ID in your Google Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | From your Google Service Account JSON file |
| `GOOGLE_PRIVATE_KEY` | From your Google Service Account JSON file |

---

### Step 6: Set Up Google Sheets Logging
1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Rename the first sheet tab to **Logs**
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`
4. Go to [console.cloud.google.com](https://console.cloud.google.com)
5. Create a new project
6. Go to **APIs & Services** → **Enable APIs** → search for and enable **Google Sheets API**
7. Go to **IAM & Admin** → **Service Accounts** → **Create Service Account**
8. Give it any name → click **Create and Continue** → click **Done**
9. Click the service account → **Keys** tab → **Add Key** → **Create new key** → **JSON**
10. Download the JSON file — open it and copy:
    - `client_email` → paste as `GOOGLE_SERVICE_ACCOUNT_EMAIL` in Cloudflare
    - `private_key` → paste as `GOOGLE_PRIVATE_KEY` in Cloudflare
11. Go back to your Google Sheet → click **Share** → paste the `client_email` → give it **Editor** access

---

### Step 7: Connect Telnyx Webhook
1. Go to [Telnyx Mission Control Portal](https://portal.telnyx.com)
2. Go to **Messaging** → **Messaging Profiles**
3. Click your messaging profile
4. Set **Inbound Webhook URL** to:
   `https://sms-chatbot.YOUR-NAME.workers.dev/webhook`
   (find your Worker URL in Cloudflare dashboard → Workers & Pages → your worker)
5. Save

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

## Managing Whitelist & Blacklist

Go to Cloudflare Dashboard → **D1** → your database → **Console** tab and run SQL directly:

```sql
-- Add your number to whitelist
INSERT INTO whitelist (phone_number, label) VALUES ('+1234567890', 'My number');

-- Block a number
INSERT INTO blacklist (phone_number, reason) VALUES ('+1234567890', 'Spam');

-- View whitelist
SELECT * FROM whitelist;

-- View blacklist
SELECT * FROM blacklist;

-- Remove from blacklist
DELETE FROM blacklist WHERE phone_number = '+1234567890';
```

> If the whitelist is **empty**, ALL numbers can use the bot (except blacklisted ones).
> If the whitelist has **any entries**, ONLY those numbers can use the bot.

---

## Making Changes

1. Open your repo on GitHub → press `.` to open GitHub.dev
2. Edit any file
3. Commit via Source Control panel
4. Cloudflare auto-deploys within ~1 minute

---

## Viewing Logs
- **Conversation logs:** Check your Google Sheet → Logs tab
- **Worker logs:** Cloudflare Dashboard → Workers & Pages → your worker → **Logs** tab
