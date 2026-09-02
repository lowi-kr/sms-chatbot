// integrations/providers/adapters/google.js - Adapter for direct Google
// Gemini API calls (BYOK only).
//
// Differs from the OpenAI-compatible shape in three ways:
//   1. Auth is a `?key=` query param, not an Authorization header.
//   2. The model is part of the URL path, not the request body — base_url in
//      the providers table is the models root (see schema.sql), and this
//      adapter appends `/{model}:generateContent`.
//   3. Request/response use `contents` + `parts` instead of `messages`, and
//      there's no distinct 'assistant' role — Gemini uses 'model'.

const REQUEST_TIMEOUT_MS = 25000;

export async function callGoogle({ apiKey, baseUrl, model, messages }) {
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const url = `${baseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents,
    generationConfig: { temperature: 0.9, maxOutputTokens: 350 },
  };
  if (systemMsg?.content) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Google request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (model=${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Never log the response body verbatim here without checking — Google
    // sometimes echoes the request back on 400s, which would include the
    // conversation text. Log status only; the caller's model/host context is
    // enough to debug from Cloudflare logs alongside a 400.
    console.error(`Google API error (model=${model}): status ${response.status}`);
    throw new Error(`Google API error: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join('') || null;
  if (!text) throw new Error('No text content in Google response');

  return {
    text,
    finishReason: candidate?.finishReason || null,
    modelUsed: model,
    inputTokens: data.usageMetadata?.promptTokenCount || 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
  };
}
