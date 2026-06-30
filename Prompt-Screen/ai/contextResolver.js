async function getFetch() {
  if (typeof fetch === "function") return fetch
  const mod = await import("node-fetch")
  return mod.default
}

async function ollamaGenerate(prompt, options = {}) {
  const useAI = options.useAI !== false
  const enabled = useAI && process.env.OLLAMA_ENABLED !== "false"
  if (!enabled) return null

  const url = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b"

  try {
    const fetchImpl = await getFetch()
    const response = await fetchImpl(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false })
    })
    if (!response.ok) return null
    const payload = await response.json()
    return String(payload?.response || "").trim() || null
  } catch (_) {
    return null
  }
}

// Generic slot resolver: static → ollama → rule → default
// To add a new slot: add a resolveSlot() call in resolveContext() and return it.
async function resolveSlot({ staticVal, ollamaPrompt, ruleFallback, defaultText, maxWords, isTitleField, validator, useAI }) {
  if (staticVal) return staticVal

  if (ollamaPrompt) {
    const raw = await ollamaGenerate(ollamaPrompt, { useAI })
    if (raw) {
      // Take only the first line (prevents multi-line explanations)
      const firstLine = raw.split(/[\n\r]/)[0].trim()
      const text = maxWords ? firstLine.split(/\s+/).slice(0, maxWords).join(" ") : firstLine
      if (text.length <= 80) {
        // For title fields: reject if it looks like an explanation sentence
        if (isTitleField) {
          const lower = text.toLowerCase()
          const looksLikeExplanation = /^(here|these|the following|this|below|some|a few|please|note)/.test(lower)
            || lower.includes(" are ") || lower.includes(" is a ")
          if (!looksLikeExplanation) return text
        } else if (validator) {
          // Custom validator: only accept if it passes
          if (validator(text)) return text
        } else {
          return text
        }
      }
    }
  }

  return ruleFallback || defaultText
}

const CTA_VERBS = [
  ["book",      "Book"],
  ["booking",   "Book"],
  ["schedule",  "Schedule"],
  ["invite",    "Invite"],
  ["hire",      "Hire"],
  ["assign",    "Assign"],
  ["apply",     "Apply"],
  ["upload",    "Upload"],
  ["send",      "Send"],
  ["order",     "Place Order"],
  ["purchase",  "Purchase"],
  ["pay",       "Make Payment"],
  ["payment",   "Make Payment"],
  ["register",  "Register"],
  ["enroll",    "Enroll"],
  ["create",    "Create"],
  ["add",       "Add"],
  ["save",      "Save"],
  ["submit",    "Submit"]
]

const CTA_ICONS = [
  ["book",      "Icon/Calendar"],
  ["booking",   "Icon/Calendar"],
  ["schedule",  "Icon/Calendar"],
  ["upload",    "Icon/Upload"],
  ["send",      "Icon/Send"],
  ["pay",       "Icon/Money"],
  ["payment",   "Icon/Money"],
  ["register",  "Icon/User-add"],
  ["enroll",    "Icon/User-add"],
  ["invite",    "Icon/User-add"],
  ["hire",      "Icon/User-add"],
  ["order",     "Icon/Cart"],
  ["purchase",  "Icon/Cart"],
  ["assign",    "Icon/Assign"],
  ["save",      "Icon/Save"],
  ["create",    "Icon/Plus"],
  ["add",       "Icon/Plus"]
]

function ctaFromPrompt(prompt, entity) {
  const normalized = String(prompt || "").toLowerCase()
  for (const [keyword, verb] of CTA_VERBS) {
    if (normalized.includes(keyword)) {
      if (verb.includes(" ")) return verb
      return entity ? `${verb} ${entity}` : verb
    }
  }
  // Default: form submit should always be an action verb, not navigation
  return entity ? `Add ${entity}` : "Add Item"
}

function ctaIconFromPrompt(prompt) {
  const normalized = String(prompt || "").toLowerCase()
  for (const [keyword, icon] of CTA_ICONS) {
    if (normalized.includes(keyword)) return icon
  }
  return null
}

const STOP_WORDS = new Set([
  "i", "ai", "want", "to", "a", "an", "the", "my", "our", "for", "of", "in",
  "create", "make", "build", "add", "manage", "form", "page", "app",
  "and", "with", "that", "this", "is", "are", "be", "can", "we", "us"
])

const FLOW_WORDS = new Set([
  "dashboard", "grid", "flow", "app", "application", "form", "page", "list", "table", "view", "screen", "ui"
])

function headerTextFromPrompt(prompt) {
  const words = String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))

  if (!words.length) return null

  return words
    .slice(0, 3)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function titleCase(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function subjectFromPrompt(prompt) {
  const words = String(prompt || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !FLOW_WORDS.has(w))
    .filter(w => !STOP_WORDS.has(w))

  if (!words.length) return null

  const phrase = words.slice(0, 5).join(" ")
  return titleCase(phrase)
}

function ctaForFilled(entity) {
  if (!entity) return "Save"
  const words = String(entity).trim().split(/\s+/).filter(Boolean)
  const tail = words.length ? words[words.length - 1] : ""
  return tail ? `Save ${tail}` : "Save"
}

function toTwoWordCta(actionText, entity) {
  const action = String(actionText || "").trim().split(/\s+/)[0] || "Add"
  const words = String(entity || "").trim().split(/\s+/).filter(Boolean)
  const tail = words.length ? words[words.length - 1] : "Item"
  return `${action} ${tail}`
}

// Resolve all context slots for a prompt + domain in one call.
// To add a new slot: add a resolveSlot() call and include it in the return object.
async function resolveContext(prompt, domain, options = {}) {
  const useAI = options.useAI !== false
  const texts = (domain && domain.texts) || {}
  const entity = domain && (domain.entity || domain.title || domain.name) || ""
  // Only use entity as a static header value when it came from a known domain model.
  // Prompt-fallback entities (last token of prompt, e.g. "form") are not meaningful.
  const knownDomain = domain && domain.source === "domain-models"
  const subject = knownDomain ? (entity || null) : (subjectFromPrompt(prompt) || entity || null)
  const subjectForText = subject || entity || ""

  // Run independent Ollama calls in parallel
  const [ctaText, headerText, headerDescription, formTitle, hintText] = await Promise.all([
    resolveSlot({
      staticVal: texts.ctaText || (domain && domain.ctaText),
      ollamaPrompt: `Submit button label for a form that adds or saves "${entity || prompt}". Must start with "Add" or "Save". 2-3 words only, no punctuation.`,
      ruleFallback: ctaFromPrompt(prompt, subjectForText || entity),
      defaultText: "Submit",
      useAI,
      validator: function(text) {
        return /^(add|save|submit|book|schedule|invite|hire|assign|apply|upload|send|place|purchase|make|register|enroll|create)\b/i.test(text)
      }
    }),
    resolveSlot({
      staticVal: texts.headerText || (knownDomain ? entity : null) || null,
      ollamaPrompt: `Page heading for a form about "${prompt}". 2-3 words max, title case, no punctuation.`,
      ruleFallback: headerTextFromPrompt(prompt),
      defaultText: "Dashboard",
      useAI,
      maxWords: 3
    }),
    resolveSlot({
      staticVal: texts.headerDescription,
      ollamaPrompt: `Page subtitle for a form used to "${prompt}". Max 10 words, plain text, no punctuation.`,
      ruleFallback: subjectForText ? `Manage and track your ${String(subjectForText).toLowerCase()} records` : null,
      defaultText: "Manage your records",
      useAI,
      maxWords: 10
    }),
    resolveSlot({
      staticVal: texts.formTitle,
      ollamaPrompt: `Reply with ONLY a 2-4 word title (title case, no punctuation) for a form to add a new "${subjectForText || prompt}". Do NOT include "Dashboard", "Grid", "App", "Page", or "Portal". Output the title only. Example: Add New Vendor`,
      ruleFallback: subjectForText ? `Create New ${subjectForText}` : null,
      defaultText: "Create New Item",
      useAI,
      maxWords: 4,
      isTitleField: true,
      validator: function(text) {
        return !/\b(dashboard|grid|app|portal|page)\b/i.test(text)
      }
    }),
    resolveSlot({
      staticVal: texts.hintText,
      ollamaPrompt: `7 to 10 word hint message for a form used to "${prompt}". Plain text, no punctuation.`,
      ruleFallback: subjectForText ? `Fill in all required details to add a new ${String(subjectForText).toLowerCase()}` : null,
      defaultText: "Fill in all required fields to continue",
      useAI,
      maxWords: 10
    })
  ])

  const ctaIcon = texts.ctaIcon || ctaIconFromPrompt(prompt) || "Icon/Plus"

  const formTitleFilled = subjectForText ? `Create New ${subjectForText}` : null
  const ctaTextFilled = ctaForFilled(subjectForText)
  const ctaTwoWord = toTwoWordCta(ctaText, subjectForText)
  const ctaFilledTwoWord = ctaTwoWord

  return {
    ctaText: ctaTwoWord,
    headerText,
    headerDescription,
    ctaIcon,
    formTitle,
    hintText,
    subject: subjectForText || null,
    formTitleFilled,
    ctaTextFilled: ctaFilledTwoWord
  }
}

module.exports = resolveContext
