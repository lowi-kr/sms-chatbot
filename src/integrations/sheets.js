// sheets.js - Google Sheets logging via Service Account
// All exported functions are fully wrapped — they log errors internally and
// never throw, so a Sheets failure can never break the main bot pipeline.
// Every export goes through withSheets(), which owns that contract: skip when
// Sheets isn't configured, mint an access token, swallow-and-log any failure.

import { base64UrlFromString, base64UrlFromBytes } from '../utils/encoding.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const LOG_RANGE = 'Logs!A:H';
const LOG_TAB = 'Logs';
const LOG_COLUMNS = [
  'Timestamp', 'Phone Number', 'Conversation', 'Role',
  'Message Length (chars)', 'Model Used', 'Input Tokens', 'Output Tokens',
];

async function getAccessToken(env) {
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  const now = Math.floor(Date.now() / 1000);
  const claim = base64UrlFromString(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const privateKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const keyData = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(`${header}.${claim}`)
  );
  const sig = base64UrlFromBytes(signature);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claim}.${sig}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to obtain access token: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function sheetsConfigured(env) {
  return !!(env.GOOGLE_SHEETS_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

// Single place where the "never break the pipeline" contract lives: no-op when
// Sheets isn't configured, and any throw is logged under `label` and swallowed.
async function withSheets(env, label, fn) {
  try {
    if (!sheetsConfigured(env)) return;
    const accessToken = await getAccessToken(env);
    await fn(accessToken);
  } catch (err) {
    console.error(`${label} error:`, err.message);
  }
}

function sheetsFetch(env, accessToken, pathAndQuery, { method = 'GET', body } = {}) {
  const headers = { 'Authorization': `Bearer ${accessToken}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${SHEETS_API}/${env.GOOGLE_SHEETS_ID}${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function appendLogRow(env, accessToken, row, query = '') {
  return sheetsFetch(env, accessToken, `/values/${LOG_RANGE}:append?valueInputOption=USER_ENTERED${query}`, {
    method: 'POST',
    body: { values: [row] },
  });
}

function errorText(response) {
  return response.text().catch(() => '(unreadable)');
}

// Columns: Timestamp | Phone Number | Conversation | Role | Message Length (chars) | Model Used | Input Tokens | Output Tokens
export async function logToSheets(env, { phoneNumber, conversationName, role, message, modelUsed, inputTokens, outputTokens }) {
  await withSheets(env, 'logToSheets', async (accessToken) => {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    const response = await appendLogRow(env, accessToken, [
      timestamp,
      phoneNumber,
      conversationName,
      role,
      message.length,
      modelUsed || '',
      inputTokens ?? '',
      outputTokens ?? '',
    ]);

    if (!response.ok) {
      const detail = await errorText(response);
      if (response.status === 401 || response.status === 403) {
        console.error('Sheets auth error — check service account permissions:', detail);
      } else {
        console.error('Sheets append failed:', response.status, detail);
      }
    }
  });
}

export async function initializeSheet(env) {
  await withSheets(env, 'initializeSheet', async (accessToken) => {
    await sheetsFetch(env, accessToken, `/values/${LOG_TAB}!A1:H1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: { values: [LOG_COLUMNS] },
    });
  });
}

export async function logFilteredMessage(env, { phoneNumber, message }) {
  await withSheets(env, 'logFilteredMessage', async (accessToken) => {
    const timestamp = new Date().toISOString();

    // Step 1: append the row
    const appendResponse = await appendLogRow(
      env,
      accessToken,
      [timestamp, phoneNumber, 'FILTERED', '⚠️ BLOCKED', message, '', '', ''],
      '&includeValuesInResponse=true'
    );

    if (!appendResponse.ok) {
      console.error('logFilteredMessage append failed:', appendResponse.status, await errorText(appendResponse));
      return;
    }

    const appendData = await appendResponse.json().catch(() => null);
    const updatedRange = appendData?.updates?.updatedRange;
    if (!updatedRange) {
      console.error('logFilteredMessage: no updatedRange in append response — skipping red highlight');
      return;
    }

    const rowMatch = updatedRange.match(/(\d+)$/);
    if (!rowMatch) {
      console.error('logFilteredMessage: could not parse row number from range:', updatedRange);
      return;
    }
    const rowNumber = parseInt(rowMatch[1], 10);

    // Step 2: get the sheet tab ID needed for batchUpdate
    const metaResponse = await sheetsFetch(env, accessToken, '');
    if (!metaResponse.ok) {
      console.error('logFilteredMessage: failed to fetch spreadsheet metadata — skipping red highlight');
      return;
    }

    const meta = await metaResponse.json().catch(() => null);
    const sheetTabId = meta?.sheets?.find(s => s.properties.title === LOG_TAB)?.properties.sheetId ?? 0;

    // Step 3: color the row red
    const colorResponse = await sheetsFetch(env, accessToken, ':batchUpdate', {
      method: 'POST',
      body: {
        requests: [{
          repeatCell: {
            range: {
              sheetId: sheetTabId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 0,
              endColumnIndex: 8,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1.0, green: 0.2, blue: 0.2 },
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        }],
      },
    });

    if (!colorResponse.ok) {
      console.error('logFilteredMessage: red highlight failed (row was still logged):', await errorText(colorResponse));
    }
  });
}
