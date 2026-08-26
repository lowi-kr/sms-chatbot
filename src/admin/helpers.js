// admin/helpers.js - Shared helpers for all admin/* route modules.
// Admin routes intentionally surface REAL error messages (unlike SMS-facing
// routes, which always show generic messages) since the admin needs to debug.
// dbTry() is the standard way any route wraps a DB/network operation so a
// failure comes back as { error: <real message> } instead of a raw 500.

import { corsHeaders, jsonResponse } from '../http/responses.js';

export { readJsonBody } from '../http/responses.js';

export const CORS_HEADERS = corsHeaders('GET, POST, DELETE, OPTIONS');

export function json(data, status = 200) {
  return jsonResponse(data, status, CORS_HEADERS);
}

export function unauthorized() {
  return json({ error: 'Unauthorized' }, 401);
}

export function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '') === env.ADMIN_SECRET;
}

// Wraps an async operation (usually one or more D1 calls) and converts any
// thrown error into a real, readable JSON error response rather than letting
// it bubble up as an opaque 500 or crash the request.
export async function dbTry(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('Admin route error:', err.message);
    return json({ error: err.message }, 500);
  }
}
