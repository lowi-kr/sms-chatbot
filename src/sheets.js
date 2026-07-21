// sheets.js - Google Sheets logging via Service Account
// All exported functions are fully wrapped — they log errors internally and
// never throw, so a Sheets failure can never break the main bot pipeline.

async function getAccessToken(env) {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const now = Math.floor(Date.now() / 1000);
  const claim = btoa(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

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

  const signingInput = `${header}.${claim}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

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

// Columns: Timestamp | Phone Number | Conversation | Role | Message Length (chars) | Model Used | Input Tokens | Output Tokens
export async function logToSheets(env, { phoneNumber, conversationName, role, message, modelUsed, inputTokens, outputTokens }) {
  try {
    if (!sheetsConfigured(env)) return;

    const accessToken = await getAccessToken(env);
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}/values/Logs!A:H:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[
            timestamp,
            phoneNumber,
            conversationName,
            role,
            message.length,
            modelUsed || '',
            inputTokens ?? '',
            outputTokens ?? '',
          ]],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '(unreadable)');
      if (response.status === 401 || response.status === 403) {
        console.error('Sheets auth error — check service account permissions:', errorText);
      } else {
        console.error('Sheets append failed:', response.status, errorText);
      }
    }
  } catch (err) {
    console.error('logToSheets error:', err.message);
  }
}

export async function initializeSheet(env) {
  try {
    if (!sheetsConfigured(env)) return;

    const accessToken = await getAccessToken(env);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}/values/Logs!A1:H1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [['Timestamp', 'Phone Number', 'Conversation', 'Role', 'Message Length (chars)', 'Model Used', 'Input Tokens', 'Output Tokens']],
        }),
      }
    );
  } catch (err) {
    console.error('initializeSheet error:', err.message);
  }
}

export async function logFilteredMessage(env, { phoneNumber, message }) {
  try {
    if (!sheetsConfigured(env)) return;

    const accessToken = await getAccessToken(env);
    const timestamp = new Date().toISOString();

    // Step 1: append the row
    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}/values/Logs!A:H:append?valueInputOption=USER_ENTERED&includeValuesInResponse=true`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[timestamp, phoneNumber, 'FILTERED', '⚠️ BLOCKED', message, '', '', '']],
        }),
      }
    );

    if (!appendResponse.ok) {
      const errText = await appendResponse.text().catch(() => '(unreadable)');
      console.error('logFilteredMessage append failed:', appendResponse.status, errText);
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
    const metaResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!metaResponse.ok) {
      console.error('logFilteredMessage: failed to fetch spreadsheet metadata — skipping red highlight');
      return;
    }

    const meta = await metaResponse.json().catch(() => null);
    const sheetTabId = meta?.sheets?.find(s => s.properties.title === 'Logs')?.properties.sheetId ?? 0;

    // Step 3: color the row red
    const colorResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEETS_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      }
    );

    if (!colorResponse.ok) {
      const errText = await colorResponse.text().catch(() => '(unreadable)');
      console.error('logFilteredMessage: red highlight failed (row was still logged):', errText);
    }
  } catch (err) {
    console.error('logFilteredMessage error:', err.message);
  }
}
