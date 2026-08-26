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

import {
  CORS_HEADERS, json, unauthorized, checkAuth, adminSecretConfigured, readJsonBody,
} from './helpers.js';
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
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    // Fail closed rather than comparing two undefineds below.
    if (!adminSecretConfigured(env)) {
      console.error('Admin route misconfigured: ADMIN_SECRET is not set');
      return json({ error: 'Server misconfigured: ADMIN_SECRET is not set' }, 500);
    }

    if (path === '/api/login' && request.method === 'POST') {
      const { body, error } = await readJsonBody(request);
      if (error) return error;
      if (body.password === env.ADMIN_SECRET) return json({ token: env.ADMIN_SECRET });
      return json({ error: 'Invalid password' }, 401);
    }

    if (!adminSecretConfigured(env)) {
      console.error('Admin route misconfigured: ADMIN_SECRET is not set');
      return json({ error: 'Server misconfigured: ADMIN_SECRET is not set' }, 500);
    }
    if (!checkAuth(request, env)) return unauthorized();

    for (const handler of ROUTE_HANDLERS) {
      const result = await handler(request, env, path);
      if (result) return result;
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error('Unhandled admin route error:', err);
    return json({ error: err.message }, 500);
  }
}
