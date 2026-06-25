// sheets.js - Google Sheets logging via Service Account

async function getAccessToken(env) {
  // Create JWT for Google Service Account
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

  // Sign with private key
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

  const jwt = `${signingInput}.${sig}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();

  // Validate access token exists
  if (!tokenData.access_token) {
    throw new Error('Failed to obtain access token: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}

// Columns: Timestamp | Phone Number | Conversation | Role | Message Length (chars) | Model Used | Input Tokens | Output Tokens
export async function logToSheets(env, { phoneNumber, conversationName, role, message, modelUsed, inputTokens, outputTokens }) {
  try {
    if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      console.log('Google Sheets not configured, skipping log');
      return;
    }

    const accessToken = await getAccessToken(env);
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    const sheetId = env.GOOGLE_SHEETS_ID;

    // Only log metadata, not actual message content for privacy
    const messageLength = message.length;

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Logs!A:H:append?valueInputOption=USER_ENTERED`,
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
            messageLength,
            modelUsed || '',
            inputTokens ?? '',
            outputTokens ?? '',
          ]],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      // Log auth errors separately for easier debugging
      if (response.status === 401 || response.status === 403) {
        console.error('Sheets auth error - check service account permissions:', errorText);
      } else {
        console.error('Sheets log failed:', errorText);
      }
    }
  } catch (err) {
    // Never let logging failures break the chatbot
    console.error('Sheets logging error:', err.message);
  }
}

export async function initializeSheet(env) {
  try {
    const accessToken = await getAccessToken(env);
    const sheetId = env.GOOGLE_SHEETS_ID;

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Logs!A1:H1?valueInputOption=USER_ENTERED`,
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
    console.error('Sheet init error:', err.message);
  }
}
export async function logFilteredMessage(env, { phoneNumber, message }) {
  try {
    if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
      return;
    }

    const accessToken = await getAccessToken(env);
    const timestamp = new Date().toISOString();
    const sheetId = env.GOOGLE_SHEETS_ID;

    // First append the row (FILTERED rows keep the original 5-column shape; the extra
    // model/token columns are simply left blank for these rows)
    const appendResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Logs!A:H:append?valueInputOption=USER_ENTERED&includeValuesInResponse=true`,
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

    const appendData = await appendResponse.json();
    
    // Get the row number that was just added
    const updatedRange = appendData.updates?.updatedRange;
    if (!updatedRange) return;

    // Extract row number from range like "Logs!A15:H15"
    const rowMatch = updatedRange.match(/(\d+)$/);
    if (!rowMatch) return;
    const rowNumber = parseInt(rowMatch[1]);

    // Now color that row red
    // First get sheet ID (not the spreadsheet ID)
    const metaResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );
    const meta = await metaResponse.json();
    const sheetTabId = meta.sheets?.find(s => s.properties.title === 'Logs')?.properties.sheetId ?? 0;

    // Apply red background to the row
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
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
                  backgroundColor: {
                    red: 1.0,
                    green: 0.2,
                    blue: 0.2,
                  },
                  textFormat: {
                    bold: true,
                    foregroundColor: {
                      red: 1.0,
                      green: 1.0,
                      blue: 1.0,
                    }
                  }
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          }],
        }),
      }
    );
  } catch (err) {
    console.error('Filtered message log error:', err);
  }
}
