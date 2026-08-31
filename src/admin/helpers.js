// admin/helpers.js - Shared helpers for all admin/* route modules.
// Admin routes intentionally surface REAL error messages (unlike SMS-facing
// routes, which always show generic messages) since the admin needs to debug.
// dbTry() is the standard way any route wraps a DB/network operation so a
// failure comes back as { error: <real message> } instead of a raw 500.

import { corsHeaders, jsonResponse, readJsonBody as httpReadJsonBody } from '../http/responses.js';

export const CORS_HEADERS = corsHeaders('GET, POST, DELETE, OPTIONS');

export function json(data, status = 200) {
  return jsonResponse(data, status, CORS_HEADERS);
}

export function unauthorized() {
  return json({ error: 'Unauthorized' }, 401);
}

// True only when ADMIN_SECRET is actually set. Without this check, checkAuth()
// would compare the request's bearer token against `undefined` — an attacker
// sending literally no Authorization header still fails that compare, but it's
// a fragile coincidence, not a real guarantee, and a misconfigured deploy
// (secret never set) would silently look "secure" while actually being wide
// open to anyone who sends "Bearer undefined". Fail closed instead.
export function adminSecretConfigured(env) {
  return !!env?.ADMIN_SECRET;
}

export function checkAuth(request, env) {
  if (!adminSecretConfigured(env)) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '') === env.ADMIN_SECRET;
}

// Admin-specific wrapper around the shared http/responses.js readJsonBody:
// bakes in CORS_HEADERS so a malformed-body 400 still carries the right
// Access-Control-Allow-* headers instead of failing the browser's CORS check
// on top of the 400 itself.
export function readJsonBody(request) {
  return httpReadJsonBody(request, CORS_HEADERS);
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
