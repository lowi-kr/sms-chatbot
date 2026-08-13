// admin/models.js - Live OpenRouter model catalog, cached ~10 min per isolate.
// Public endpoint on OpenRouter's side (no API key needed) — used to populate
// the model pickers in the dashboard.

import { json } from './helpers.js';

let modelsCache = { data: null, fetchedAt: 0 };
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchOpenRouterModels() {
  const now = Date.now();
  if (modelsCache.data && (now - modelsCache.fetchedAt) < MODELS_CACHE_TTL_MS) {
    return modelsCache.data;
  }

  const resp = await fetch('https://openrouter.ai/api/v1/models');
  if (!resp.ok) {
    throw new Error(`OpenRouter models fetch failed: ${resp.status}`);
  }
  const data = await resp.json();
  const slim = (data.data || []).map(m => ({
    id: m.id,
    name: m.name,
    context_length: m.context_length || null,
    is_free: m.id.endsWith(':free'),
    prompt_price: m.pricing?.prompt || null,
    completion_price: m.pricing?.completion || null,
  })).sort((a, b) => a.id.localeCompare(b.id));

  modelsCache = { data: slim, fetchedAt: now };
  return slim;
}

export async function handleModels(request, env, path) {
  if (path !== '/api/openrouter-models' || request.method !== 'GET') return null;

  try {
    const models = await fetchOpenRouterModels();
    return json(models);
  } catch (err) {
    return json({ error: 'Failed to fetch model list', detail: err.message }, 502);
  }
}
