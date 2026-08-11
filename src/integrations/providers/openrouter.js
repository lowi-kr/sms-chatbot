// openrouter.js - OpenRouter API integration (OpenAI-compatible)
// Handles per-number model selection, token-limit enforcement, and fallback.

import { buildSystemPrompt } from '../../security/filter.js';
import { getEffectiveConfig, recordTokenUsage } from '../../db/index.js';

const DEFAULT_MODEL = 'openrouter/free';
const REQUEST_TIMEOUT_MS = 25000;

// Every fetch to OpenRouter gets its own AbortController so the timeout
// applies independently to the primary call AND any fallback call.
async function callOpenRouter(env, model, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sms-chatbot.blowi7745.workers.dev/',
        'X-Title': 'SMS Chatbot',
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
    // Re-throw with a clearer message distinguishing timeout from network error
    if (err.name === 'AbortError') {
      throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s (model=${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const error = await response.text().catch(() => '(unreadable body)');
    console.error(`OpenRouter API error (model=${model}):`, error);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  return response.json();
}

// Returns { text, modelUsed, inputTokens, outputTokens, blocked }
// overrideModel: if provided (e.g. from the test console picker), skips D1 resolution
// for the primary model and uses this directly. Fallback/limit logic still applies.
// memoryFacts: array of decrypted durable-fact strings for this phone number (or null),
// injected into the system prompt via buildSystemPrompt. Callers are responsible for
// fetching/decrypting this (see processMessage.js) — this function never touches D1
// memory rows or ENCRYPTION_KEY itself, it only receives already-decrypted strings.
export async function getOpenRouterResponse(env, phoneNumber, conversationHistory, userMessage, overrideModel = null, memoryFacts = null) {
  const db = env.DB;
  const config = await getEffectiveConfig(db, phoneNumber);

  const messages = [
    { role: 'system', content: buildSystemPrompt(memoryFacts) },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  let modelToUse = overrideModel || config.model || DEFAULT_MODEL;
  let usingFallback = false;

  // Over token limit — block or switch to fallback before even calling
  if (config.isOverLimit) {
    if (config.fallbackModel === 'block') {
      return {
        text: "You've reached your usage limit for this assistant. Please contact the admin to increase your limit.",
        modelUsed: null,
        inputTokens: 0,
        outputTokens: 0,
        blocked: true,
      };
    }
    modelToUse = config.fallbackModel;
    usingFallback = true;
  }

  let data;
  try {
    data = await callOpenRouter(env, modelToUse, messages);
  } catch (primaryErr) {
    // Primary model failed — try fallback if we haven't already and one is configured
    if (!usingFallback && config.fallbackModel && config.fallbackModel !== 'block') {
      console.error(`Primary model "${modelToUse}" failed, trying fallback "${config.fallbackModel}":`, primaryErr.message);
      modelToUse = config.fallbackModel;
      usingFallback = true;
      // Fallback call gets its own fresh timeout via callOpenRouter
      data = await callOpenRouter(env, modelToUse, messages);
    } else {
      throw primaryErr;
    }
  }

  const choice = data.choices?.[0];
  if (!choice) throw new Error('No choices in OpenRouter response');

  if (choice.finish_reason === 'content_filter') {
    return {
      text: "I'm sorry, I can't respond to that. Please keep our conversation appropriate.",
      modelUsed: modelToUse,
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      blocked: false,
    };
  }

  const rawText = choice.message?.content || "I couldn't generate a response. Please try again.";
  const text = rawText.length > 950 ? rawText.substring(0, 947) + '...' : rawText;

  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;

  // Token usage recording is best-effort — a D1 failure here must not discard
  // a valid AI response that's already been generated
  try {
    await recordTokenUsage(db, phoneNumber, inputTokens, outputTokens);
  } catch (err) {
    console.error('Failed to record token usage (continuing):', err.message);
  }

  return {
    text,
    modelUsed: data.model || modelToUse,
    inputTokens,
    outputTokens,
    blocked: false,
  };
}

// ---------------------------------------------------------------
// Conversation auto-naming
// ---------------------------------------------------------------
// Separate lightweight call — deliberately does NOT reuse getOpenRouterResponse,
// since fallback/limit/token-tracking logic doesn't apply here.
// Naming never counts against a user's token limit and always uses the
// admin-configured naming model regardless of per-number chat model overrides.

const NAMING_SYSTEM_PROMPT = `Generate a short, specific 3-5 word title summarizing this conversation. Respond with ONLY the title text — no quotes, no ending punctuation, no preamble, no explanation.`;

export async function generateConversationTitle(env, namingModel, conversationHistory) {
  const excerpt = conversationHistory.slice(0, 6).map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
  }));

  if (!excerpt.length) return null;

  const messages = [
    { role: 'system', content: NAMING_SYSTEM_PROMPT },
    ...excerpt,
  ];

  const data = await callOpenRouter(env, namingModel, messages);
  const choice = data.choices?.[0];
  let title = choice?.message?.content?.trim() || null;
  if (!title) return null;

  title = title.replace(/^["'""]+|["'""]+$/g, '').trim();
  if (!title) return null;
  if (title.length > 60) title = title.substring(0, 57) + '...';

  return title;
}

// ---------------------------------------------------------------
// Memory extraction
// ---------------------------------------------------------------
// Separate, lightweight call, same philosophy as generateConversationTitle: doesn't
// touch fallback/limit/token-tracking, doesn't count against chat limits, always uses
// the admin-configured memory_model regardless of per-number chat model overrides.
// This function is pure text-in/text-out — it never touches D1 or ENCRYPTION_KEY.
// The caller (src/core/memoryExtraction.js) owns fetching conversation history and
// encrypting/storing the result.

const MEMORY_EXTRACTION_PROMPT = `You extract durable facts worth remembering about a person from an SMS conversation, so a future conversation can reference them naturally.

Rules:
- Only extract facts that are likely to remain true for weeks/months (preferences, ongoing projects, named people/pets, recurring context) — not one-off details from a single message.
- Each fact: one short sentence, plain text, no more than ~12 words.
- Return between 0 and 8 facts. Merge/update rather than duplicate similar facts.
- Respond with ONLY a JSON array of strings, e.g. ["Has a dog named Max","Works as an HVAC technician"]. No markdown, no explanation. If nothing durable was said, respond with [].`;

// existingFacts: array of prior fact strings (or null) to merge/update against.
// Returns an array of strings (possibly empty), or null on failure (caller should
// skip saving/overwriting existing memory in that case).
export async function extractMemory(env, memoryModel, conversationHistory, existingFacts) {
  if (!conversationHistory.length) return null;

  const transcript = conversationHistory
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');

  const existingBlock = existingFacts && existingFacts.length
    ? `\n\nExisting known facts (update/merge, don't just re-list unchanged ones):\n${existingFacts.map(f => `- ${f}`).join('\n')}`
    : '';

  const messages = [
    { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
    { role: 'user', content: `Conversation:\n${transcript}${existingBlock}` },
  ];

  try {
    const data = await callOpenRouter(env, memoryModel, messages);
    const choice = data.choices?.[0];
    let raw = choice?.message?.content?.trim();
    if (!raw) return null;

    // Strip markdown code fences some models add anyway.
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed
      .filter(f => typeof f === 'string' && f.trim())
      .map(f => f.trim().slice(0, 200))
      .slice(0, 8);
  } catch (err) {
    console.error('Memory extraction error:', err.message);
    return null;
  }
}