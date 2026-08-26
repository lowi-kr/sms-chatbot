import { beforeEach, describe, expect, it, vi } from 'vitest';
const routeMocks = vi.hoisted(() => ({
  handleContacts: vi.fn(), handleSend: vi.fn(), handleLists: vi.fn(), handleSupport: vi.fn(),
  handleModels: vi.fn(), handleSettings: vi.fn(), handleNumbers: vi.fn(), handleStats: vi.fn(),
}));
vi.mock('../../src/admin/contacts.js', () => ({ handleContacts: routeMocks.handleContacts }));
vi.mock('../../src/admin/send.js', () => ({ handleSend: routeMocks.handleSend }));
vi.mock('../../src/admin/lists.js', () => ({ handleLists: routeMocks.handleLists }));
vi.mock('../../src/admin/support.js', () => ({ handleSupport: routeMocks.handleSupport }));
vi.mock('../../src/admin/models.js', () => ({ handleModels: routeMocks.handleModels }));
vi.mock('../../src/admin/settings.js', () => ({ handleSettings: routeMocks.handleSettings }));
vi.mock('../../src/admin/numbers.js', () => ({ handleNumbers: routeMocks.handleNumbers }));
vi.mock('../../src/admin/stats.js', () => ({ handleStats: routeMocks.handleStats }));

import { handleAdminRequest } from '../../src/admin/index.js';
import { makeEnv } from '../helpers/env.js';

const env = makeEnv();
const request = (path, options = {}) => new Request(`https://example.com${path}`, options);

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(routeMocks)) fn.mockResolvedValue(null);
});

describe('handleAdminRequest', () => {
  it('handles CORS, login, auth, not found, fallthrough, and thrown route errors', async () => {
    expect((await handleAdminRequest(request('/api/x', { method: 'OPTIONS' }), env)).headers.get('Access-Control-Allow-Origin')).toBe('*');
    const login = await handleAdminRequest(request('/api/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_SECRET }) }), env);
    expect(login.status).toBe(200);
    await expect(login.json()).resolves.toEqual({ token: env.ADMIN_SECRET });
    expect((await handleAdminRequest(request('/api/login', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) }), env)).status).toBe(401);
    expect((await handleAdminRequest(request('/api/contacts'), env)).status).toBe(401);
    routeMocks.handleContacts.mockResolvedValueOnce(null);
    routeMocks.handleSend.mockResolvedValueOnce(new Response('handled', { status: 202 }));
    const handled = await handleAdminRequest(request('/api/contacts', { headers: { Authorization: `Bearer ${env.ADMIN_SECRET}` } }), env);
    expect(handled.status).toBe(202);
    const missing = await handleAdminRequest(request('/api/not-real', { headers: { Authorization: env.ADMIN_SECRET } }), env);
    expect(missing.status).toBe(404);
    routeMocks.handleContacts.mockRejectedValueOnce(new Error('route exploded'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await handleAdminRequest(request('/api/contacts', { headers: { Authorization: env.ADMIN_SECRET } }), env);
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: 'route exploded' });
    error.mockRestore();
  });
});
