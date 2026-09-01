// http/responses.js - CORS/JSON response plumbing shared by every HTTP surface
// (admin API and the TEST_MODE-only /test route), so the two can't drift apart.

export function corsHeaders(methods) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// Parses a JSON request body. On success returns { body }. On malformed/absent
// JSON returns { error: <Response> } with a ready-to-return 400 response, so
// callers can do `const { body, error } = await readJsonBody(request, headers);
// if (error) return error;` instead of guessing whether {} means "no body" or
// "body was garbage" (previously request.json().catch(() => ({})) conflated
// the two, so a genuinely malformed request silently looked like a request
// with no fields, and callers had to reverse-engineer which field was
// "missing" from a body that was never valid JSON in the first place).
// headers: extra headers (e.g. CORS) to attach to the 400 error response —
// defaults to {} for callers that don't need any (e.g. a bare /test route).
export async function readJsonBody(request, headers = {}) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: jsonResponse({ error: 'Invalid JSON body' }, 400, headers) };
  }
}
