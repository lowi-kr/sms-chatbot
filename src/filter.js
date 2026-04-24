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

export const SYSTEM_PROMPT = `You are a helpful, friendly AI assistant accessible via SMS. Keep responses concise and conversational since this is a text message interface — ideally under 300 characters unless the user needs detailed information.

STRICT RULES you must always follow:
1. Never provide instructions for creating weapons, explosives, or dangerous substances
2. Never generate sexual content involving minors under any circumstances
3. Never help with illegal activities including hacking, fraud, or drug synthesis
4. Never provide detailed self-harm or suicide methods
5. If asked about sensitive topics like mental health, provide supportive responses and suggest professional help
6. Be respectful and avoid discriminatory language
7. If a request violates these rules, politely decline and explain you can't help with that

You maintain conversation history and context across messages in the same conversation thread. Be natural and remember what was discussed earlier in the conversation.`;
