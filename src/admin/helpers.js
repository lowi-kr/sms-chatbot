// admin/helpers.js - Shared helpers for all admin/* route modules.
// Admin routes intentionally surface REAL error messages (unlike SMS-facing
// routes, which always show generic messages) since the admin needs to debug.
// dbTry() is the standard way any route wraps a DB/network operation so a
// failure comes back as { error: <real message> } instead of a raw 500.

export function corsHeaders(request, env) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const configuredOrigins = typeof env.ADMIN_ALLOWED_ORIGINS === 'string'
    ? env.ADMIN_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : [];

  if (!env.ADMIN_ALLOWED_ORIGINS) {
    headers['Access-Control-Allow-Origin'] = '*';
  } else {
    headers.Vary = 'Origin';
    const origin = request.headers.get('Origin');
    if (origin && configuredOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
  }
  return headers;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function unauthorized() {
  return json({ error: 'Unauthorized' }, 401);
}

export function checkAuth(request, env) {
  if (!env.ADMIN_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  if (auth.length < 7 || auth.slice(0, 7).toLowerCase() !== 'bearer ') return false;
  return timingSafeEqualStr(auth.slice(7), env.ADMIN_SECRET);
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;

  const maxLength = Math.max(a.length, b.length);
  let difference = 0;
  for (let i = 0; i < maxLength; i++) {
    const aCode = i < a.length ? a.charCodeAt(i) : 0;
    const bCode = i < b.length ? b.charCodeAt(i) : 0;
    difference |= aCode ^ bCode;
  }
  const sameLength = a.length === b.length;
  return difference === 0 && sameLength;
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
