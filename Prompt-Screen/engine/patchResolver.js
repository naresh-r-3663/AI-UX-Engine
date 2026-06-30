// engine/patchResolver.js
// Resolves a screen's patch field and applies it to its rendered frame.
// patch is array  → structured ops, applied directly (no AI)
// patch is string → NL, resolved via Ollama with real frame node context

const path      = require("path")
const fs        = require("fs")
const patchFrame = require("../patcher/framePatcher")

// ─── Ollama ───────────────────────────────────────────────────────────────────
async function getFetch() {
  if (typeof fetch === "function") return fetch
  const mod = await import("node-fetch")
  return mod.default
}

async function ollamaGenerate(prompt) {
  if (process.env.OLLAMA_ENABLED === "false") return null
  const url   = process.env.OLLAMA_URL   || "http://127.0.0.1:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b"
  try {
    const fetchImpl = await getFetch()
    const res = await fetchImpl(`${url}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model, prompt, stream: false })
    })
    if (!res.ok) return null
    const data = await res.json()
    return String(data?.response || "").trim() || null
  } catch (_) {
    return null
  }
}

// ─── Frame node summary for AI context ───────────────────────────────────────
function buildNodeSummary(frame) {
  const countByType = {}
  const lines       = []

  function collect(node) {
    if (node.type === "SLOT_INSTRUCTION" && node.role) {
      const role = node.role
      if (!countByType[role]) countByType[role] = 0
      const nth = countByType[role]++
      lines.push(`{ "find": "${role}", "nth": ${nth}, "name": "${node.name}", "type": "SLOT_INSTRUCTION" }`)
    } else if (node.type === "INSTANCE" && node.componentName &&
        !String(node.componentName).startsWith("slot.") &&
        !String(node.componentName).startsWith("input.")) {
      const cn  = node.componentName
      if (!countByType[cn]) countByType[cn] = 0
      const nth = countByType[cn]++
      const vs  = (node.meta && node.meta.variantState) ? node.meta.variantState : "Default"
      lines.push(`{ "find": "${cn}", "nth": ${nth}, "currentState": "${vs}", "type": "INSTANCE" }`)
    }
    if (Array.isArray(node.children)) node.children.forEach(collect)
  }
  collect(frame)
  return lines.join("\n") || "(no nodes found)"
}

// ─── componentPropertyMap summary for AI context ─────────────────────────────
function buildPropertySummary() {
  const mapPath = path.join(__dirname, "..", "config", "componentPropertyMap.json")
  if (!fs.existsSync(mapPath)) return ""
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"))
  return Object.entries(map).map(function([comp, props]) {
    const states = Object.entries(props)
      .filter(function([, p]) { return p.type === "VARIANT" })
      .map(function([propName, p]) { return `${propName}: [${p.values.join(", ")}]` })
      .join("; ")
    return states ? `${comp} → ${states}` : null
  }).filter(Boolean).join("\n")
}

// ─── NL patch → structured ops via Ollama ────────────────────────────────────
async function resolveNLPatch(patchStr, frame, screenName) {
  const nodeSummary  = buildNodeSummary(frame)
  const propSummary  = buildPropertySummary()

  const prompt = `You resolve a UI patch instruction into a JSON array of patch ops. Output ONLY a valid JSON array, nothing else.

Screen: "${screenName}"
Patch instruction: "${patchStr}"

Rendered nodes in this frame (find + nth = how to target each node):
${nodeSummary}

Available component states (componentName → property: [allowed values]):
${propSummary}

Patch op format:
[{ "find": "<value>", "nth": <0-based index among same type>, "set": { "<field>": "<value>" } }]

Rules:
- For SLOT_INSTRUCTION nodes: "find" = the role exactly (e.g. "card", "row"), "set" writes any field directly (cardState, rowState, etc.)
- For INSTANCE nodes: "find" = componentName prefix, "set" uses "variantState" with an allowed value
- "nth" selects which occurrence (0 = first, 1 = second, 2 = third, etc.)
- Return multiple ops in the array if the instruction affects multiple nodes
- NEVER invent component names — only use "find" values that appear in the node list above

Examples:
"make first dropdown active"        -> [{"find":"comp.input.dropdown","nth":0,"set":{"variantState":"Active"}}]
"disable second text field"         -> [{"find":"comp.input.text","nth":1,"set":{"variantState":"Disabled"}}]
"third card state card hover"       -> [{"find":"card","nth":2,"set":{"cardState":"Card Hover"}}]
"first row hover"                   -> [{"find":"row","nth":0,"set":{"rowState":"Row Hover"}}]
"change 3rd child card state to card hover" -> [{"find":"card","nth":2,"set":{"cardState":"Card Hover"}}]

Now resolve: "${patchStr}"
JSON:`

  const raw = await ollamaGenerate(prompt)
  if (!raw) return null

  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed
  } catch (_) {
    return null
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function applyPatch(frame, patch, screenName) {
  let ops

  if (Array.isArray(patch)) {
    // Structured — use directly, no AI
    ops = patch
  } else if (typeof patch === "string" && patch.trim()) {
    // Natural language — resolve via Ollama with real frame context
    ops = await resolveNLPatch(patch.trim(), frame, screenName)
    if (!ops) {
      console.warn(
        `[Patcher] SKIPPED "${screenName}": Ollama could not resolve patch "${patch}".` +
        ` Ensure Ollama is running (OLLAMA_ENABLED != false) or use structured patch array.`
      )
      return { skipped: true }
    }
  } else {
    return { skipped: true }
  }

  const { errors } = patchFrame(frame, ops)
  if (errors.length) {
    errors.forEach(function(e) { console.warn(`[Patcher] "${screenName}": ${e}`) })
  }
  return { skipped: false, ops, errors }
}

module.exports = applyPatch
