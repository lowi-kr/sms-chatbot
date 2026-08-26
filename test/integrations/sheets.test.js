import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeSheet, logFilteredMessage, logToSheets } from '../../src/integrations/sheets.js';
import { makeEnv } from '../helpers/env.js';

const configured = () => makeEnv({
  GOOGLE_SHEETS_ID: 'sheet-123',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nAQID\\n-----END PRIVATE KEY-----',
});
const tokenResponse = () => ({ ok: true, json: vi.fn().mockResolvedValue({ access_token: 'access-token' }) });
const successResponse = (body = {}) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(body),
  text: vi.fn().mockResolvedValue(''),
});
const failureResponse = (status, body = 'failure') => ({
  ok: false,
  status,
  json: vi.fn().mockResolvedValue({}),
  text: vi.fn().mockResolvedValue(body),
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue({});
  vi.spyOn(globalThis.crypto.subtle, 'sign').mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Google Sheets logging', () => {
  it('does not fetch when any required configuration is missing', async () => {
    for (const key of ['GOOGLE_SHEETS_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) {
      const env = configured();
      delete env[key];
      await logToSheets(env, { phoneNumber: '+1', conversationName: 'Chat', role: 'user', message: 'secret' });
      await initializeSheet(env);
      await logFilteredMessage(env, { phoneNumber: '+1', message: 'secret' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('appends an eight-column metadata row without message content', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(successResponse());
    await logToSheets(configured(), {
      phoneNumber: '+1555',
      conversationName: 'Chat',
      role: 'assistant',
      message: 'private response',
    });
    const [url, options] = fetch.mock.calls[1];
    expect(url).toContain('/values/Logs!A:H:append');
    expect(options.headers.Authorization).toBe('Bearer access-token');
    const row = JSON.parse(options.body).values[0];
    expect(row).toHaveLength(8);
    expect(row[1]).toBe('+1555');
    expect(row[4]).toBe(16);
    expect(row[5]).toBe('');
    expect(row[6]).toBe('');
    expect(row[7]).toBe('');
    expect(options.body).not.toContain('private response');
  });

  it('logs append failures distinctly and never throws', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failureResponse(403, 'forbidden'));
    await expect(logToSheets(configured(), {
      phoneNumber: '+1', conversationName: 'x', role: 'user', message: 'x', modelUsed: 'm',
      inputTokens: 2, outputTokens: 3,
    })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('Sheets auth error — check service account permissions:', 'forbidden');

    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failureResponse(500, 'broken'));
    await logToSheets(configured(), { phoneNumber: '+1', conversationName: 'x', role: 'user', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('Sheets append failed:', 500, 'broken');

    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failureResponse(401));
    await logToSheets(configured(), { phoneNumber: '+1', conversationName: 'x', role: 'user', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('Sheets auth error — check service account permissions:', 'failure');
  });

  it('swallows missing access tokens and thrown fetch errors', async () => {
    fetch.mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ error: 'bad credentials' }) });
    await expect(logToSheets(configured(), { phoneNumber: '+1', conversationName: 'x', role: 'user', message: 'x' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('logToSheets error:', expect.stringContaining('Failed to obtain access token'));

    fetch.mockRejectedValueOnce(new Error('network down'));
    await expect(initializeSheet(configured())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('initializeSheet error:', 'network down');
  });

  it('initializes the header row', async () => {
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(successResponse());
    await initializeSheet(configured());
    const [url, options] = fetch.mock.calls[1];
    expect(url).toContain('/values/Logs!A1:H1');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body).values[0]).toEqual([
      'Timestamp', 'Phone Number', 'Conversation', 'Role', 'Message Length (chars)',
      'Model Used', 'Input Tokens', 'Output Tokens',
    ]);
  });

  it('logs filtered rows and colors the appended row', async () => {
    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ...successResponse({ updates: { updatedRange: 'Logs!A5:H5' } }) })
      .mockResolvedValueOnce(successResponse({ sheets: [{ properties: { title: 'Logs', sheetId: 42 } }] }))
      .mockResolvedValueOnce(successResponse());
    await logFilteredMessage(configured(), { phoneNumber: '+1', message: 'blocked text' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[1][0]).toContain('includeValuesInResponse=true');
    expect(JSON.parse(fetch.mock.calls[1][1].body).values[0]).toContain('blocked text');
    const colorBody = JSON.parse(fetch.mock.calls[3][1].body);
    expect(colorBody.requests[0].repeatCell.range).toMatchObject({
      sheetId: 42, startRowIndex: 4, endRowIndex: 5, endColumnIndex: 8,
    });
  });

  it('stops filtered logging cleanly for malformed or failed responses', async () => {
    const env = configured();
    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(failureResponse(500));
    await logFilteredMessage(env, { phoneNumber: '+1', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage append failed:', 500, 'failure');

    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(successResponse({}));
    await logFilteredMessage(env, { phoneNumber: '+1', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage: no updatedRange in append response — skipping red highlight');

    fetch.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(successResponse({ updates: { updatedRange: 'Logs!A:H' } }));
    await logFilteredMessage(env, { phoneNumber: '+1', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage: could not parse row number from range:', 'Logs!A:H');

    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(successResponse({ updates: { updatedRange: 'Logs!A5:H5' } }))
      .mockResolvedValueOnce(failureResponse(503));
    await logFilteredMessage(env, { phoneNumber: '+1', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage: failed to fetch spreadsheet metadata — skipping red highlight');

    fetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(successResponse({ updates: { updatedRange: 'Logs!A5:H5' } }))
      .mockResolvedValueOnce(successResponse({ sheets: [] }))
      .mockResolvedValueOnce(failureResponse(500, 'color failed'));
    await logFilteredMessage(env, { phoneNumber: '+1', message: 'x' });
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage: red highlight failed (row was still logged):', 'color failed');

    fetch.mockRejectedValueOnce(new Error('network down'));
    await expect(logFilteredMessage(env, { phoneNumber: '+1', message: 'x' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('logFilteredMessage error:', 'network down');
  });
});
