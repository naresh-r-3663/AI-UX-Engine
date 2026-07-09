// ai/aiProvider.js
// Single provider abstraction for every AI call in the engine.
// All AI files (fieldFallbackGenerator, itemNameResolver, contextResolver,
// aiScreenResolver, patchResolver) route their LLM calls through generateText().
//
// Provider is chosen per-request (config passed from the UI) or from env vars:
//   AI_PROVIDER = ollama | anthropic | openai   (default: ollama)
//
// generateText() always returns a raw text string or null. Callers keep their
// own JSON-extraction/parsing — this only swaps WHO answers the prompt.

async function getFetch() {
  if (typeof fetch === "function") return fetch
  const mod = await import("node-fetch")
  return mod.default
}

function defaultModel(provider) {
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-opus-4-8"
  if (provider === "openai") return process.env.OPENAI_MODEL || "gpt-4o-mini"
  return process.env.OLLAMA_MODEL || "llama3.1:8b"
}

function defaultBaseUrl(provider) {
  if (provider === "openai") return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  return process.env.OLLAMA_URL || "http://127.0.0.1:11434"
}

function apiKeyFromEnv(provider) {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || ""
  if (provider === "openai") return process.env.OPENAI_API_KEY || ""
  return ""
}

// Per-request config (from the Settings modal) overrides env defaults.
function resolveConfig(config = {}) {
  const provider = String(config.provider || process.env.AI_PROVIDER || "ollama").toLowerCase()
  return {
    provider,
    model: config.model || defaultModel(provider),
    apiKey: config.apiKey || apiKeyFromEnv(provider),
    baseUrl: config.baseUrl || defaultBaseUrl(provider)
  }
}

// ─── Ollama (local) ──────────────────────────────────────────────────────────
async function callOllama(prompt, cfg, temperature) {
  if (process.env.OLLAMA_ENABLED === "false") return null
  const fetchImpl = await getFetch()
  const body = { model: cfg.model, prompt, stream: false }
  if (typeof temperature === "number") body.options = { temperature }
  const res = await fetchImpl(`${cfg.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    console.error("[aiProvider:ollama] HTTP error:", res.status)
    return null
  }
  const data = await res.json()
  return String(data?.response || "").trim() || null
}

// ─── Anthropic Claude (official SDK) ───────────────────────────────────────────
async function callAnthropic(prompt, cfg) {
  if (!cfg.apiKey) {
    console.error("[aiProvider:anthropic] No API key (set it in Settings or ANTHROPIC_API_KEY)")
    return null
  }
  let Anthropic
  try {
    Anthropic = require("@anthropic-ai/sdk")
  } catch (_) {
    console.error("[aiProvider:anthropic] @anthropic-ai/sdk not installed — run: npm install @anthropic-ai/sdk")
    return null
  }
  // Opus 4.8 rejects temperature / top_p — steer via prompting instead, so we
  // intentionally omit temperature here.
  const client = new Anthropic({ apiKey: cfg.apiKey })
  const msg = await client.messages.create({
    model: cfg.model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }]
  })
  const text = (msg.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim()
  return text || null
}

// ─── OpenAI / OpenAI-compatible (LM Studio, llama.cpp, etc.) ───────────────────
async function callOpenAI(prompt, cfg, temperature) {
  if (!cfg.apiKey) {
    console.error("[aiProvider:openai] No API key (set it in Settings or OPENAI_API_KEY)")
    return null
  }
  const fetchImpl = await getFetch()
  const body = {
    model: cfg.model,
    messages: [{ role: "user", content: prompt }]
  }
  if (typeof temperature === "number") body.temperature = temperature
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    console.error("[aiProvider:openai] HTTP error:", res.status)
    return null
  }
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content || "").trim() || null
}

// ─── Public API ────────────────────────────────────────────────────────────────
// opts: { temperature?: number, useAI?: boolean, config?: { provider, model, apiKey, baseUrl } }
async function generateText(prompt, opts = {}) {
  if (opts.useAI === false) return null
  const cfg = resolveConfig(opts.config)
  const temperature = typeof opts.temperature === "number" ? opts.temperature : undefined

  try {
    if (cfg.provider === "anthropic") return await callAnthropic(prompt, cfg)
    if (cfg.provider === "openai") return await callOpenAI(prompt, cfg, temperature)
    return await callOllama(prompt, cfg, temperature)
  } catch (err) {
    console.error(`[aiProvider:${cfg.provider}] call failed:`, err.message)
    return null
  }
}

module.exports = { generateText, resolveConfig }
