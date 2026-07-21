// index.js - Worker entry point. Routing only — no business logic lives here.
// TEST_MODE=true (set in wrangler.toml [vars]) enables /test and /test-ui routes.

import { handleWebhook } from './handlers/webhook.js';
import { handleTestUi, handleTestCors, handleTestPost } from './handlers/testRoute.js';

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

    return new Response('Not Found', { status: 404 });
  },
};
