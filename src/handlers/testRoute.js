// handlers/testRoute.js - Handles GET /test-ui and POST /test.
// Both routes are only active when TEST_MODE=true.

import { TEST_PAGE_HTML } from '../ui/testpage.js';
import { processMessage } from '../core/processMessage.js';
import { checkAuth } from '../admin/helpers.js';
import { isValidModelId, isValidPhone, normalizePhone, MAX_MESSAGE_LENGTH } from '../security/validate.js';

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
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function handleTestPost(request, env, ctx) {
  if (env.TEST_MODE !== 'true') {
    return new Response(
      'Test endpoint is disabled. Set TEST_MODE=true on this worker to enable it.',
      { status: 404 }
    );
  }

  if (env.ADMIN_SECRET) {
    if (!checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else {
    console.warn('TEST_MODE is enabled without ADMIN_SECRET; /test is unauthenticated');
  }

  const body = await request.json().catch(() => ({}));
  if (!isValidPhone(body.from)) {
    return new Response('Body "from" must be a valid E.164 phone number', {
      status: 400,
    });
  }
  if (typeof body.text !== 'string' || body.text.trim().length === 0 || body.text.length > MAX_MESSAGE_LENGTH) {
    return new Response(`Body "text" must be a non-empty string of at most ${MAX_MESSAGE_LENGTH} characters`, {
      status: 400,
    });
  }
  if (body.model !== undefined && body.model !== null && !isValidModelId(body.model)) {
    return new Response('Body "model" must be a valid model ID', { status: 400 });
  }

  const from = normalizePhone(body.from);
  const result = await processMessage(env, ctx, from, body.text, true, body.model || null);
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
