// index.js - Worker entry point. Routing only — no business logic lives here.
// TEST_MODE=true (set in wrangler.toml [vars]) enables /test and /test-ui routes.
//
// /api/* now routes into src/admin/index.js — this used to be the separate,
// inline-editor-only sms-chatbot-admin-api worker. It shares this worker's
// D1 binding and Telnyx secrets automatically, but never receives
// ENCRYPTION_KEY usage (see src/admin/index.js for the privacy boundary).

import { handleWebhook } from './handlers/webhook.js';
import { handleTestUi, handleTestCors, handleTestPost } from './handlers/testRoute.js';
import { handleAdminRequest } from './admin/index.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    if (pathname === '/test-ui' && method === 'GET') {
      return handleTestUi(env);
    }

    if (pathname === '/test' && method === 'OPTIONS') {
      return handleTestCors();
    }

    if (pathname === '/test' && method === 'POST') {
      return handleTestPost(request, env, ctx);
    }

    if (pathname === '/webhook' && method === 'POST') {
      return handleWebhook(request, env, ctx);
    }

    if (pathname.startsWith('/api/')) {
      return handleAdminRequest(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};
