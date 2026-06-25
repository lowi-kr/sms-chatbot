// openrouter.js - OpenRouter API integration (OpenAI-compatible)

import { SYSTEM_PROMPT } from './filter.js';
import { getSetting } from './db.js';

const DEFAULT_MODEL = 'openrouter/free';

export async function getOpenRouterResponse(env, conversationHistory, userMessage) {
  const db = env.DB;

  // Read the configured model from D1 (dashboard-editable), fall back to free router
  const model = await getSetting(db, 'ai_model', DEFAULT_MODEL);

  // Build messages array in OpenAI chat format
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // Optional but recommended by OpenRouter for attribution/leaderboards
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
    console.error('OpenRouter API error:', error);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();

  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error('No response from OpenRouter');
  }

  // OpenRouter/some providers use finish_reason "content_filter" for moderation blocks
  if (choice.finish_reason === 'content_filter') {
    return "I'm sorry, I can't respond to that. Please keep our conversation appropriate.";
  }

  const responseText = choice.message?.content || "I couldn't generate a response. Please try again.";

  // Hard truncate to 950 chars to respect SMS limits
  return responseText.length > 950 ? responseText.substring(0, 947) + '...' : responseText;
}
