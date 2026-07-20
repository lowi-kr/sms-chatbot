// filter.js - Content filtering

const BLOCKED_KEYWORDS = [
  // Violence
  'how to kill', 'how to murder', 'how to hurt', 'how to attack',
  // Weapons/Explosives  
  'how to make a bomb', 'how to make explosives', 'pipe bomb', 'ied',
  // Drugs
  'how to make meth', 'how to synthesize', 'drug synthesis',
  // CSAM - never
  'child porn', 'cp ', 'csam', 'minor sex',
  // Self harm
  'how to commit suicide', 'how to self harm', 'ways to kill myself',
  // Hacking
  'how to hack into', 'steal passwords', 'credit card numbers',
];

export function containsBlockedContent(text) {
  const lower = text.toLowerCase();
  return BLOCKED_KEYWORDS.some(keyword => lower.includes(keyword));
}

const BASE_SYSTEM_PROMPT = `You are a helpful, friendly AI assistant accessible via SMS. You MUST keep responses under 950 characters — this is a hard SMS limit. Aim for under 320 characters for simple replies. Only go longer when the user explicitly asks for detail. Never use markdown formatting — no *, no #, no bold. Use plain dashes - for lists instead.

STRICT RULES you must always follow:
1. Never provide instructions for creating weapons, explosives, or dangerous substances
2. Never generate sexual content involving minors under any circumstances
3. Never help with illegal activities including hacking, fraud, or drug synthesis
4. Never provide detailed self-harm or suicide methods
5. If asked about sensitive topics like mental health, provide supportive responses and suggest professional help
6. Be respectful and avoid discriminatory language
7. If a request violates these rules, politely decline and explain you can't help with that

You maintain conversation history and context across messages in the same conversation thread. Be natural and remember what was discussed earlier in the conversation.`;

// Kept for backward compatibility with any code still importing the raw constant directly.
// New code should call buildSystemPrompt(memoryFacts) instead so memory gets injected.
export const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

// memoryFacts: array of short, already-decrypted fact strings, or null/empty/undefined.
// Returns the system prompt with a memory section appended when facts exist.
export function buildSystemPrompt(memoryFacts) {
  if (!memoryFacts || !memoryFacts.length) return BASE_SYSTEM_PROMPT;

  const factsBlock = memoryFacts.map(f => `- ${f}`).join('\n');
  return `${BASE_SYSTEM_PROMPT}

What you remember about this contact from past conversations (use naturally, don't recite this list verbatim, and don't mention that you have "memory" or "notes" unless asked):
${factsBlock}`;
}