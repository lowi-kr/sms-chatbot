// openrouter.js - OpenRouter API integration (OpenAI-compatible)
// Handles per-number model selection, token-limit enforcement, and fallback.

import { SYSTEM_PROMPT } from './filter.js';
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
export async function getOpenRouterResponse(env, phoneNumber, conversationHistory, userMessage) {
  const db = env.DB;
  const config = await getEffectiveConfig(db, phoneNumber);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // If already over the lifetime token limit, decide block vs fallback up front.
  let modelToUse = config.model || DEFAULT_MODEL;
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
