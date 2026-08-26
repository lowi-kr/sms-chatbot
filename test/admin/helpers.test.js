import { describe, expect, it, vi } from 'vitest';
import { checkAuth, dbTry, json, unauthorized } from '../../src/admin/helpers.js';

describe('admin helpers', () => {
  it('creates CORS JSON responses and unauthorized 401', async () => {
    const response = json({ ok: true }, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(unauthorized().status).toBe(401);
  });
  it('checks bearer, bare, wrong, missing, and empty credentials', () => {
    const env = { ADMIN_SECRET: 'secret' };
    expect(checkAuth(new Request('https://x', { headers: { Authorization: 'Bearer secret' } }), env)).toBe(true);
    expect(checkAuth(new Request('https://x', { headers: { Authorization: 'secret' } }), env)).toBe(true);
    expect(checkAuth(new Request('https://x', { headers: { Authorization: 'Bearer wrong' } }), env)).toBe(false);
    expect(checkAuth(new Request('https://x'), env)).toBe(false);
    expect(checkAuth(new Request('https://x', { headers: { Authorization: '' } }), env)).toBe(false);
  });
  it('returns values and exposes real errors as JSON', async () => {
    await expect(dbTry(() => 'value')).resolves.toBe('value');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await dbTry(async () => { throw new Error('real problem'); });
    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({ error: 'real problem' });
    error.mockRestore();
  });
});
