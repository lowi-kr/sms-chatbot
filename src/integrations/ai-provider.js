// integrations/ai-provider.js - Provider-agnostic chat entry point.
//
// This is the new call site processMessage.js uses instead of importing
// getOpenRouterResponse() from providers/openrouter.js directly. It adds BYOK
// key resolution and the web-search quick win on top of the exact same
// limit/fallback/notice behavior openrouter.js already had, so this is meant
// to be a drop-in replacement with an identical return shape:
//   { text, modelUsed, inputTokens, outputTokens, blocked }
//
// Naming (autoNaming.js) and memory extraction (memoryExtraction.js) are
// UNCHANGED and continue to import generateConversationTitle/extractMemory
// directly from providers/openrouter.js — they're cheap/free-tier calls that
// don't need BYOK or per-number model overrides, so routing them through this
// resolution cascade would add complexity with no benefit. See the
// feature-byok Notion log for the reasoning.
//
// Resolution order for a chat turn:
//   1. Compute the effective model/fallback/limit/webSearch config (unchanged
//      from openrouter.js — src/db/numbers.js getEffectiveConfig()).
//   2. Over limit + fallbackModel === 'block' → same "you've hit your limit"
//      response as before, unchanged.
//   3. Try to resolve a BYOK key scoped to the target model (see
//      providers/keyResolution.js for the exact cascade). If found, call that
//      provider's adapter directly with the admin's own key — this call is
//      NOT counted against the per-number OpenRouter token limit, and is not
//      logged into tokens_input_used/tokens_output_used (BYOK usage isn't
//      tracked in this version — see feature-byok scoping notes).
//   4. If BYOK resolution hard-fails (an always_use key exists but is
//      unusable), return a blocked response — mirrors the existing
//      fallbackModel === 'block' behavior so callers don't need a new case.
//   5. Otherwise (no BYOK key applies), fall through to OpenRouter exactly as
//      before, including the existing primary→fallback→error-notice logic.
//      This is also the only path the web-search quick win applies to (see
//      below) — BYOK direct-provider calls don't support it in this version.

import { buildSystemPrompt } from '../security/filter.js';
import { getEffectiveConfig, recordTokenUsage } from '../db/index.js';
import { truncateForSms } from '../utils/text.js';
import { resolveKeyForModel } from './providers/keyResolution.js';
import { callOpenAiCompatible } from './providers/adapters/openai-compatible.js';
import { callAnthropic } from './providers/adapters/anthropic.js';
import { callGoogle } from './providers/adapters/google.js';

const DEFAULT_MODEL = 'openrouter/free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FALLBACK_WORKER_URL = '';

const LIMIT_FALLBACK_NOTICE = "(You're at your message limit for now, so I've switched to a lighter model to keep chatting.)";
const ERROR_FALLBACK_NOTICE = "(Having a hiccup with my usual setup, so I switched things up to get you an answer.)";
const BYOK_UNAVAILABLE_NOTICE = "This assistant's configured model is temporarily unavailable. Please contact the admin.";

function withNotice(text, notice) {
  return truncateForSms(`${notice}\n\n${text}`);
}

// Applies the OpenRouter-only web-search quick win. Uses the ':online' model
// suffix (simpler than the plugins:[{id:'web'}] body form and works for any
// model OpenRouter supports) rather than mutating the request body shape.
function applyWebSearchSuffix(model, webSearchEnabled) {
  if (!webSearchEnabled) return model;
  if (model.endsWith(':online')) return model; // already applied, e.g. explicit override
  return `${model}:online`;
}

// Dispatches to the correct adapter for a resolved BYOK provider + key.
async function callByokProvider(provider, apiKey, model, messages) {
  switch (provider.adapter) {
    case 'openai-compatible':
      return callOpenAiCompatible({ apiKey, baseUrl: provider.base_url, model, messages });
    case 'anthropic':
      return callAnthropic({ apiKey, baseUrl: provider.base_url, model, messages });
    case 'google':
      return callGoogle({ apiKey, baseUrl: provider.base_url, model, messages });
    default:
      throw new Error(`Unknown adapter "${provider.adapter}" for provider "${provider.id}"`);
  }
}

async function callOpenRouter(env, model, messages) {
  return callOpenAiCompatible({
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: OPENROUTER_URL,
    model,
    messages,
    extraHeaders: {
      // See providers/openrouter.js's original comment: WORKER_URL lives in
      // wrangler.toml [vars] rather than being hardcoded, since this file is
      // public in the repo. Not a secret, but kept out of source.
      'HTTP-Referer': env.WORKER_URL || FALLBACK_WORKER_URL,
      'X-Title': 'SMS Chatbot',
    },
  });
}

// Returns { text, modelUsed, inputTokens, outputTokens, blocked }
// Same signature as the old getOpenRouterResponse — see providers/openrouter.js.
export async function getAiResponse(env, phoneNumber, conversationHistory, userMessage, overrideModel = null, memoryFacts = null) {
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

  // Over token limit — block or switch to fallback before even calling,
  // unchanged from the original OpenRouter-only behavior.
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
  }

  // ---- BYOK resolution (new in feature-byok) ----
  // Only attempted for the primary model resolution above — the over-limit
  // fallback model above is intentionally NOT re-checked against BYOK, since
  // fallback models are meant to be cheap/lightweight and BYOK keys are an
  // admin's own paid credentials.
  if (!config.isOverLimit && env.ENCRYPTION_KEY) {
    try {
      const resolution = await resolveKeyForModel(db, env.ENCRYPTION_KEY, modelToUse);

      if (resolution.outcome === 'hard-fail') {
        console.error(`BYOK key id=${resolution.keyId} is marked always_use but is unusable — hard-failing per admin config`);
        return {
          text: BYOK_UNAVAILABLE_NOTICE,
          modelUsed: null,
          inputTokens: 0,
          outputTokens: 0,
          blocked: true,
        };
      }

      if (resolution.outcome === 'use-key') {
        try {
          const result = await callByokProvider(resolution.provider, resolution.apiKey, modelToUse, messages);
          return {
            text: truncateForSms(result.text || "I couldn't generate a response. Please try again."),
            modelUsed: result.modelUsed || modelToUse,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            blocked: false,
          };
        } catch (byokErr) {
          if (resolution.alwaysUse) {
            // Admin said never fall back for this model — surface the outage
            // rather than silently spending OpenRouter credits on their behalf.
            console.error(`BYOK call failed for always_use key id=${resolution.keyId}:`, byokErr.message);
            return {
              text: BYOK_UNAVAILABLE_NOTICE,
              modelUsed: null,
              inputTokens: 0,
              outputTokens: 0,
              blocked: true,
            };
          }
          // Not always_use — fall through to OpenRouter below, same spirit as
          // the existing primary-model-failed → fallback-model logic.
          console.error(`BYOK call failed for key id=${resolution.keyId}, falling through to OpenRouter:`, byokErr.message);
        }
      }
      // outcome === 'no-key' → fall through to OpenRouter below, no action needed.
    } catch (resolutionErr) {
      // Resolution itself errored (e.g. a D1 hiccup) — never let BYOK
      // machinery break the chat turn. Fall through to OpenRouter.
      console.error('BYOK key resolution error (falling through to OpenRouter):', resolutionErr.message);
    }
  }

  // ---- OpenRouter path (existing behavior, now including web search) ----

  let usingFallback = modelToUse === config.fallbackModel && config.isOverLimit;
  let fallbackReason = usingFallback ? 'limit' : null;

  const primaryModelWithSearch = applyWebSearchSuffix(modelToUse, config.webSearch);

  let data;
  try {
    data = await callOpenRouter(env, primaryModelWithSearch, messages);
  } catch (primaryErr) {
    if (!usingFallback && config.fallbackModel && config.fallbackModel !== 'block') {
      const primaryModel = primaryModelWithSearch;
      console.error(`Primary model "${primaryModel}" failed, trying fallback "${config.fallbackModel}":`, primaryErr.message);
      modelToUse = config.fallbackModel;
      usingFallback = true;
      fallbackReason = 'error';
      const fallbackModelWithSearch = applyWebSearchSuffix(modelToUse, config.webSearch);
      try {
        data = await callOpenRouter(env, fallbackModelWithSearch, messages);
      } catch (fallbackErr) {
        throw new Error(
          `Primary model "${primaryModel}" failed (${primaryErr.message}) and fallback "${fallbackModelWithSearch}" also failed: ${fallbackErr.message}`,
          { cause: fallbackErr }
        );
      }
    } else {
      throw primaryErr;
    }
  }

  if (data.finishReason === 'content_filter') {
    return {
      text: "I'm sorry, I can't respond to that. Please keep our conversation appropriate.",
      modelUsed: modelToUse,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      blocked: false,
    };
  }

  const rawText = data.text || "I couldn't generate a response. Please try again.";
  let text = truncateForSms(rawText);

  if (fallbackReason === 'limit') {
    text = withNotice(rawText, LIMIT_FALLBACK_NOTICE);
  } else if (fallbackReason === 'error') {
    text = withNotice(rawText, ERROR_FALLBACK_NOTICE);
  }

  // Token usage recording stays OpenRouter-only by design — BYOK calls above
  // return before reaching this line, so this only ever records usage that
  // actually went against the admin's OpenRouter account/limit.
  try {
    await recordTokenUsage(db, phoneNumber, data.inputTokens, data.outputTokens);
  } catch (err) {
    console.error('Failed to record token usage (continuing):', err.message);
  }

  return {
    text,
    modelUsed: data.modelUsed || modelToUse,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    blocked: false,
  };
}
