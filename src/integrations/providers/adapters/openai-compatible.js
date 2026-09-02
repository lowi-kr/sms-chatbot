// integrations/providers/adapters/openai-compatible.js - Shared adapter for any
// provider that speaks the OpenAI chat-completions request/response shape.
// Used by both 'openrouter' and 'openai' provider rows (see schema.sql).
//
// This module is pure request/response translation — it never touches D1,
// ENCRYPTION_KEY, or provider key storage. Callers (ai-provider.js) are
// responsible for resolving which API key and base_url to pass in.

const REQUEST_TIMEOUT_MS = 25000;

// extraHeaders: provider-specific headers (e.g. OpenRouter's attribution
// headers) that don't belong in this shared adapter's own logic.
export async function callOpenAiCompatible({ apiKey, baseUrl, model, messages, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.9,
        max_tokens: 350,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (model=${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(unreadable body)');
    if (response.status === 429) {
      console.error(`Rate limit hit (model=${model}):`, errorBody);
    } else {
      console.error(`API error (model=${model}):`, errorBody);
    }
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error('No choices in response');

  return {
    text: choice.message?.content || null,
    finishReason: choice.finish_reason || null,
    modelUsed: data.model || model,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}
