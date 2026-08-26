// handlers/testRoute.js - Handles GET /test-ui and POST /test.
// Both routes are only active when TEST_MODE=true.

import { TEST_PAGE_HTML } from '../ui/testpage.js';
import { processMessage } from '../core/processMessage.js';
import { corsHeaders, readJsonBody } from '../http/responses.js';

const CORS_HEADERS = corsHeaders('POST, OPTIONS');

export function handleTestUi(env) {
  if (env.TEST_MODE !== 'true') {
    return new Response(
      'Test UI is disabled. Set TEST_MODE=true on this worker to enable it.',
      { status: 404 }
    );
  }
  return new Response(TEST_PAGE_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function handleTestCors() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function handleTestPost(request, env, ctx) {
  if (env.TEST_MODE !== 'true') {
    return new Response(
      'Test endpoint is disabled. Set TEST_MODE=true on this worker to enable it.',
      { status: 404 }
    );
  }

  const body = await readJsonBody(request);
  if (!body.from || !body.text) {
    return new Response('Body must include "from" and "text"', {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const result = await processMessage(env, ctx, body.from, body.text, true, body.model || null);
  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
