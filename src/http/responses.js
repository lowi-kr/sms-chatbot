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

// Parses a JSON request body, treating an absent/invalid body as {} so route
// handlers can validate individual fields instead of guarding the parse.
export function readJsonBody(request) {
  return request.json().catch(() => ({}));
}
