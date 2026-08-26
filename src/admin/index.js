// admin/index.js - Entry point for every /api/* request. Mounted into the main
// sms-chatbot worker's routing (see src/index.js) — this is what used to be
// the standalone, inline-editor-only sms-chatbot-admin-api worker.
//
// Hard privacy boundary: this module and everything it dispatches to NEVER
// touches env.ENCRYPTION_KEY. Conversation message content and memory facts
// are encrypted with a per-phone key derived from that pepper, and admin
// routes are intentionally unable to decrypt either. Do not add ENCRYPTION_KEY
// usage anywhere under src/admin/, and never add a route that returns decrypted
// message content (e.g. a "conversationMessages" endpoint).
//
// Auth: POST /api/login checks the password against ADMIN_SECRET and returns
// it as a bearer token; every other /api/* route requires that same bearer
// token via checkAuth().
//
// Error handling: admin routes show REAL error messages (not generic ones)
// since the admin needs to debug — see helpers.js's dbTry(). This top-level
// try/catch is the final backstop for anything a route handler doesn't catch
// itself.

import { corsHeaders, json, unauthorized, checkAuth, timingSafeEqualStr } from './helpers.js';
import { handleContacts } from './contacts.js';
import { handleSend } from './send.js';
import { handleLists } from './lists.js';
import { handleSupport } from './support.js';
import { handleModels } from './models.js';
import { handleSettings } from './settings.js';
import { handleNumbers } from './numbers.js';
import { handleStats } from './stats.js';

// Order doesn't matter for correctness (each handler only claims its own
// paths and returns null otherwise), but cheaper/more-frequently-hit routes
// are listed first as a minor optimization.
const ROUTE_HANDLERS = [
  handleContacts,
  handleSend,
  handleLists,
  handleSupport,
  handleModels,
  handleSettings,
  handleNumbers,
  handleStats,
];

export async function handleAdminRequest(request, env) {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === '/api/login' && request.method === 'POST') {
      if (!env.ADMIN_SECRET) {
        console.error('Admin API login rejected: ADMIN_SECRET is not configured');
        return applyCors(json({ error: 'Admin API is not configured' }, 503), cors);
      }
      const body = await request.json().catch(() => ({}));
      if (typeof body.password === 'string' &&
          body.password.length > 0 &&
          timingSafeEqualStr(body.password, env.ADMIN_SECRET)) {
        return applyCors(json({ token: env.ADMIN_SECRET }), cors);
      }
      return applyCors(json({ error: 'Invalid password' }, 401), cors);
    }

    if (!checkAuth(request, env)) return applyCors(unauthorized(), cors);

    for (const handler of ROUTE_HANDLERS) {
      const result = await handler(request, env, path);
      if (result) return applyCors(result, cors);
    }

    return applyCors(json({ error: 'Not found' }, 404), cors);
  } catch (err) {
    console.error('Unhandled admin route error:', err);
    return applyCors(json({ error: err.message }, 500), cors);
  }
}

function applyCors(response, cors) {
  const headers = { ...Object.fromEntries(response.headers), ...cors };
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
