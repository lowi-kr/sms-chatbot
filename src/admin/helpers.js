// admin/helpers.js - Shared helpers for all admin/* route modules.
// Admin routes intentionally surface REAL error messages (unlike SMS-facing
// routes, which always show generic messages) since the admin needs to debug.
// dbTry() is the standard way any route wraps a DB/network operation so a
// failure comes back as { error: <real message> } instead of a raw 500.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function unauthorized() {
  return json({ error: 'Unauthorized' }, 401);
}

export function adminSecretConfigured(env) {
  return !!env?.ADMIN_SECRET;
}

export function checkAuth(request, env) {
  if (!adminSecretConfigured(env)) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth.replace('Bearer ', '') === env.ADMIN_SECRET;
}

export async function readJsonBody(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: json({ error: 'Invalid JSON body' }, 400) };
  }
}

// Wraps an async operation (usually one or more D1 calls) and converts any
// thrown error into a real, readable JSON error response rather than letting
// it bubble up as an opaque 500 or crash the request.
export async function dbTry(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('Admin route error:', err);
    return json({ error: err.message }, 500);
  }
}
