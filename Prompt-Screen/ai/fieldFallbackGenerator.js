const fs = require("fs")
const path = require("path")

function readJson(filePath){
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    return null
  }
}

function normalize(text){
  return String(text || "").toLowerCase()
}

async function getFetch(){
  if(typeof fetch === "function"){
    return fetch
  }
  const mod = await import("node-fetch")
  return mod.default
}

// Strips UI/layout noise words to find the real entity the user wants to manage.
// "youtube channel dashboard in card ui" → "youtube channel"
// "software company dashboard"           → "software company"
const FORM_UI_NOISE = [
  "dashboard", "grid", "app", "card", "cards", "ui", "ux", "page", "list",
  "table", "view", "panel", "screen", "layout", "design", "in", "for",
  "with", "the", "a", "an", "of", "my", "our", "create", "make", "build",
  "show", "display", "manage", "management"
]

function extractFormEntity(prompt) {
  const words = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  const meaningful = words.filter(function(w) { return FORM_UI_NOISE.indexOf(w) === -1 })
  return meaningful.join(" ") || words.join(" ") || "item"
}

function buildOllamaPrompt(prompt){
  const entity = extractFormEntity(prompt)
  return [
    `You are generating form fields for an "Add New ${entity}" form in a SaaS UI.`,
    `The form lets the user create/register a new "${entity}" record.`,
    "",
    "Return ONLY valid JSON with this shape:",
    "{",
    `  "entity": "${entity}",`,
    "  \"fields\": [",
    "    {\"label\": \"<Label>\", \"type\": \"text|textarea|dropdown|date|number|email|phone|password|checkbox|button\"}",
    "  ]",
    "}",
    "",
    "Rules:",
    "- 4 to 8 fields.",
    "- Use label case (Title Case).",
    `- Fields must be input properties OF a single "${entity}" (e.g. name, URL, category, description).`,
    "- Do NOT include analytics, metrics, or dashboard stats (e.g. Subscriber Count, Watch Time, Revenue).",
    "- Do NOT include system-generated fields (e.g. ID, Created At, Updated At).",
    "- No explanations, no markdown.",
    "",
    "Examples of CORRECT fields:",
    `  For "youtube channel": Channel Name, Channel URL, Category, Description, Country`,
    `  For "software company": Company Name, Website, Industry, Founded Year, Headquarters`,
    `  For "shoe": Shoe Name, Brand, Size, Color, Price, Material`,
    "",
    "Examples of WRONG fields (do NOT generate these):",
    `  For "youtube channel": Subscriber Count, Watch Time, Total Views ← these are metrics, not input fields`,
    `  For "software company": Revenue Growth, User Engagement ← these are analytics, not form fields`,
    "",
    `Now generate fields for: "${entity}"`,
  ].join("\n")
}

// Extracts the first balanced JSON object from a string.
// More robust than a greedy regex — handles Ollama text before/after JSON.
function extractFirstJsonObject(text){
  let depth = 0
  let start = -1
  for(let i = 0; i < text.length; i++){
    if(text[i] === "{"){
      if(depth === 0) start = i
      depth++
    } else if(text[i] === "}"){
      depth--
      if(depth === 0 && start !== -1){
        return text.slice(start, i + 1)
      }
    }
  }
  return null
}

async function generateFieldsWithOllama(prompt, options = {}){
  const useAI = options.useAI !== false
  const enabled = useAI && process.env.OLLAMA_ENABLED !== "false"
  if(!enabled){
    return null
  }

  const url = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b"

  try {
    const fetchImpl = await getFetch()
    const response = await fetchImpl(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: buildOllamaPrompt(prompt),
        stream: false,
        options: { temperature: 0 }
      })
    })

    if(!response.ok){
      console.error("[Ollama] HTTP error:", response.status)
      return null
    }

    const payload = await response.json()
    const text = String(payload?.response || "").trim()
    if(!text){
      console.error("[Ollama] Empty response for prompt:", prompt)
      return null
    }

    const jsonStr = extractFirstJsonObject(text)
    if(!jsonStr){
      console.error("[Ollama] No JSON object found in response:", text.slice(0, 200))
      return null
    }

    const parsed = JSON.parse(jsonStr)
    if(!parsed || !Array.isArray(parsed.fields)){
      console.error("[Ollama] Parsed JSON has no fields array:", jsonStr.slice(0, 200))
      return null
    }

    return parsed.fields.map(field => ({
      label: field.label || null,
      type: field.type || "text",
      icon: null,
      placeholder: field.label || null,
      enabled: true,
      visible: true
    }))
  } catch (error) {
    console.error("[Ollama] Field generation failed:", error.message)
    return null
  }
}

function inferFieldType(componentName){
  const name = normalize(componentName)
  if(name.includes("textarea")) return "textarea"
  if(name.includes("dropdown")) return "dropdown"
  if(name.includes("date")) return "date"
  if(name.includes("number")) return "number"
  if(name.includes("email")) return "email"
  if(name.includes("phone")) return "phone"
  if(name.includes("password")) return "password"
  if(name.includes("checkbox")) return "checkbox"
  if(name.includes("button")) return "button"
  return "text"
}

function pickIntent(prompt, intents){
  const normalized = normalize(prompt)
  let best = null
  let bestScore = 0

  ;(intents || []).forEach(intent => {
    const matches = intent.match || []
    matches.forEach(phrase => {
      const phraseText = normalize(phrase)
      if(!phraseText){
        return
      }
      if(normalized.includes(phraseText)){
        const score = phraseText.length
        if(score > bestScore){
          best = intent
          bestScore = score
        }
      }
    })
  })

  return best
}

async function fallbackFields(prompt, options = {}){
  const ollamaFields = await generateFieldsWithOllama(prompt, options)
  if(ollamaFields && ollamaFields.length){
    return ollamaFields
  }

  const intentsPath = path.join(__dirname, "..", "knowledge", "forms", "form-intents.json")
  const data = readJson(intentsPath) || {}
  const intent = pickIntent(prompt, data.intents)

  const fields = []
  if(intent){
    const labels = intent.labels || []
    const icons = intent.icons || []
    const components = intent.fields || []

    components.forEach((componentName, index) => {
      const label = labels[index] || null
      const icon = icons[index] || null
      const type = inferFieldType(componentName)
      fields.push({
        label,
        type,
        icon,
        placeholder: label,
        enabled: true,
        visible: true
      })
    })

    return fields
  }

  // Smart prompt extraction: parse the prompt for entity/domain keywords
  // and generate meaningful fields before falling to the generic "Field 1, Field 2"
  const domainModelsPath = path.join(__dirname, "..", "config", "domainModels.json")
  const domainModels = readJson(domainModelsPath) || {}
  const normalizedPrompt = normalize(prompt)

  for (const [key, model] of Object.entries(domainModels)) {
    const keywords = Array.isArray(model.keywords) ? model.keywords : [key]
    const entity = normalize(model.entity || key)
    const matched = keywords.some(kw => normalizedPrompt.includes(normalize(kw)))
      || normalizedPrompt.includes(entity)

    if (matched && Array.isArray(model.fields) && model.fields.length) {
      return model.fields.map(f => ({
        label: f.label || null,
        type: f.type || "text",
        icon: f.icon || null,
        placeholder: f.label || null,
        enabled: true,
        visible: true
      }))
    }
  }

  const fallback = data.fallback || {}
  const fallbackLabels = fallback.labels || []
  const fallbackIcons = fallback.icons || []
  const fallbackComponents = fallback.fields || []

  fallbackComponents.forEach((componentName, index) => {
    const label = fallbackLabels[index] || `Field ${index + 1}`
    const icon = fallbackIcons[index] || null
    const type = inferFieldType(componentName)
    fields.push({
      label,
      type,
      icon,
      placeholder: label,
      enabled: true,
      visible: true
    })
  })

  return fields
}

module.exports = fallbackFields
