// integrations/providers/adapters/anthropic.js - Adapter for direct Anthropic
// API calls (BYOK only — never used for OpenRouter, which routes Anthropic
// models through the OpenAI-compatible shape instead).
//
// Anthropic differs from the OpenAI-compatible shape in two ways this adapter
// exists to handle:
//   1. Auth header is 'x-api-key' + 'anthropic-version', not 'Authorization: Bearer'.
//   2. The system prompt is a top-level `system` field, not a message with
//      role: 'system' inside the messages array.

const REQUEST_TIMEOUT_MS = 25000;
const ANTHROPIC_VERSION = '2023-06-01';

// messages: same shape ai-provider.js builds for every adapter — an array
// where the first entry may have role: 'system'. This adapter pulls that out
// into Anthropic's separate `system` field and passes the rest through.
export async function callAnthropic({ apiKey, baseUrl, model, messages }) {
  const systemMsg = messages.find(m => m.role === 'system');
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemMsg?.content || undefined,
        messages: conversationMessages,
        max_tokens: 350,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Anthropic request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (model=${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(unreadable body)');
    if (response.status === 429) {
      console.error(`Anthropic rate limit hit (model=${model}):`, errorBody);
    } else {
      console.error(`Anthropic API error (model=${model}):`, errorBody);
    }
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = Array.isArray(data.content) ? data.content.find(b => b.type === 'text') : null;
  if (!textBlock) throw new Error('No text content block in Anthropic response');

  return {
    text: textBlock.text || null,
    finishReason: data.stop_reason || null,
    modelUsed: data.model || model,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}
