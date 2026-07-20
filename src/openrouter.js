// openrouter.js - OpenRouter API integration (OpenAI-compatible)
// Handles per-number model selection, token-limit enforcement, and fallback.

import { buildSystemPrompt } from './filter.js';
import { getEffectiveConfig, recordTokenUsage } from './db.js';

const DEFAULT_MODEL = 'openrouter/free';

async function callOpenRouter(env, model, messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`OpenRouter API error (model=${model}):`, error);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  return response.json();
}

// Returns { text, modelUsed, inputTokens, outputTokens, blocked }
// overrideModel: if provided (e.g. from the test console picker), skips D1 resolution
// for the primary model and uses this directly. Fallback/limit logic still applies.
// memoryFacts: array of decrypted durable-fact strings for this phone number (or null),
// injected into the system prompt via buildSystemPrompt.
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

  // If already over the lifetime token limit, decide block vs fallback up front.
  let modelToUse = overrideModel || config.model || DEFAULT_MODEL;
  let usingFallback = false;

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
  } catch (err) {
    // Primary model failed (and we weren't already on fallback) — try the fallback model.
    if (!usingFallback && config.fallbackModel && config.fallbackModel !== 'block') {
      console.error(`Primary model "${modelToUse}" failed, trying fallback "${config.fallbackModel}"`);
      modelToUse = config.fallbackModel;
      usingFallback = true;
      data = await callOpenRouter(env, modelToUse, messages);
    } else {
      throw err;
    }
  }

  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error('No response from OpenRouter');
  }

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

  // Record usage against the number regardless of whether primary or fallback model answered.
  await recordTokenUsage(db, phoneNumber, inputTokens, outputTokens);

  return {
    text,
    modelUsed: data.model || modelToUse, // OpenRouter echoes back which model actually ran
    inputTokens,
    outputTokens,
    blocked: false,
  };
}

// ---------------------------------------------------------------
// Conversation auto-naming
// ---------------------------------------------------------------
// Separate, lightweight call — deliberately does NOT reuse getOpenRouterResponse,
// since that function's fallback/limit/token-tracking logic doesn't apply here.
// Naming never counts against a user's chat token limit, and always uses the
// admin-configured naming model regardless of that number's chat model override.

const NAMING_SYSTEM_PROMPT = `Generate a short, specific 3-5 word title summarizing this conversation. Respond with ONLY the title text — no quotes, no ending punctuation, no preamble, no explanation.`;

export async function generateConversationTitle(env, namingModel, conversationHistory) {
  // Only the first few messages are needed for a title — keeps this fast and cheap.
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

  // Strip surrounding quotes some models add anyway, and hard-cap length for the D1 column.
  title = title.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!title) return null;
  if (title.length > 60) title = title.substring(0, 57) + '...';

  return title;
}

// ---------------------------------------------------------------
// Memory extraction
// ---------------------------------------------------------------
// Separate, lightweight call, same philosophy as generateConversationTitle:
// doesn't touch fallback/limit/token-tracking, doesn't count against chat limits,
// always uses the admin-configured memory_model regardless of per-number chat overrides.
// This function never sees ENCRYPTION_KEY and never touches D1 directly — it's pure
// text-in/text-out, keeping the encryption boundary entirely in index.js.

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