const fs = require("fs")
const path = require("path")

function readJson(filePath){
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    if (fs.existsSync(filePath)) {
      console.error(`[domainResolver] Failed to parse ${filePath}: ${error.message}`)
    }
    return null
  }
}

function normalize(text){
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function tokenize(text){
  return normalize(text).split(/[^a-z0-9]+/g).filter(Boolean)
}

function titleCase(text){
  return String(text || "")
    .split(/[^a-z0-9]+/gi)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ")
}

function isExpired(meta) {
  if (!meta || !meta.expiresAt) return false
  return new Date(meta.expiresAt) < new Date()
}

function loadDomainModels(){
  const filePath = path.join(__dirname, "..", "config", "domainModels.json")
  if(!fs.existsSync(filePath)){
    return []
  }
  const data = readJson(filePath)
  if(data && typeof data === "object" && !Array.isArray(data)){
    return Object.entries(data)
      .filter(([, value]) => !isExpired(value?._meta))
      .map(([key, value]) => ({
        name: key,
        entity: value?.entity,
        fields: value?.fields || [],
        keywords: value?.keywords || [],
        texts: value?.texts || {},
        exactPrompts: value?.exactPrompts || [],
        cardNames: value?.cardNames || [],
        _meta: value?._meta || null
      }))
  }
  return []
}

function hasExactPromptMatch(normalizedPrompt, model){
  const exactPrompts = Array.isArray(model?.exactPrompts) ? model.exactPrompts : []
  return exactPrompts.some(item => normalize(item) === normalizedPrompt)
}

function wordBoundaryMatch(normalizedPrompt, keyword){
  const kw = normalize(keyword)
  if(!kw) return false
  // Multi-word phrase: require exact substring match
  if(kw.includes(" ")) return normalizedPrompt.includes(kw)
  // Single word: require whole-word match, allow optional plural 's' suffix
  // so "application" matches "applications" and vice versa
  const base = (kw.length > 3 && kw.endsWith("s")) ? kw.slice(0, -1) : kw
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp("(?:^|[^a-z0-9])" + escaped + "s?(?:[^a-z0-9]|$)")
  return re.test(normalizedPrompt)
}

function domainScore(normalizedPrompt, model){
  const keywords = model.keywords || []
  // "application" is intentionally NOT here — it's a real entity, not just a layout word
  const FLOW_KEYWORDS = ["dashboard", "grid", "app", "form", "page", "list", "table", "view", "ui", "screen", "flow"]
  let score = 0
  for(const keyword of keywords){
    const kw = normalize(keyword)
    if(wordBoundaryMatch(normalizedPrompt, kw)){
      if(FLOW_KEYWORDS.indexOf(kw) !== -1) continue
      score += kw.length * (kw.includes(" ") ? 2 : 1)
    }
  }
  return score
}

function resolveDomain(prompt){
  const models = loadDomainModels()
  const normalizedPrompt = normalize(prompt)

  for(const model of models){
    if(!model?.name) continue
    if(hasExactPromptMatch(normalizedPrompt, model)){
      const entity = model.entity || ""
      return {
        ...model,
        title: model.title || titleCase(entity || model.name),
        source: "domain-models",
        matchType: "exact"
      }
    }
  }

  let bestModel = null
  let bestScore = 0
  let bestPriority = Infinity

  for(const model of models){
    if(!model?.name) continue
    const score = domainScore(normalizedPrompt, model)
    if(score <= 0) continue
    // Priority: 0 (hand-crafted, no _meta) < 1 < 2 < 3. Lower = higher priority.
    const priority = (model._meta && typeof model._meta.priority === "number") ? model._meta.priority : 0
    if(score > bestScore || (score === bestScore && priority < bestPriority)){
      bestScore = score
      bestModel = model
      bestPriority = priority
    }
  }

  // Require a minimum score to avoid weak single-word false positives
  const MIN_KEYWORD_SCORE = 4
  if(bestModel && bestScore >= MIN_KEYWORD_SCORE){
    const entity = bestModel.entity || ""
    return {
      ...bestModel,
      title: bestModel.title || titleCase(entity || bestModel.name),
      source: "domain-models",
      matchType: "keyword"
    }
  }

  // Flow-type trigger words describe the UI layout, not the domain entity.
  // Skip them when picking the fallback name so "llm provider dashboard"
  // resolves to "Provider", not "Dashboard".
  const FLOW_KEYWORDS = ["dashboard", "grid", "app", "form", "page", "list", "table", "view"]
  const tokens = tokenize(prompt)
  const meaningfulTokens = tokens.filter(function(t) { return FLOW_KEYWORDS.indexOf(t) === -1 })
  const fallbackName = meaningfulTokens[meaningfulTokens.length - 1] || tokens[tokens.length - 1] || "generic"
  return {
    name: fallbackName,
    title: titleCase(fallbackName),
    source: "prompt",
    matchType: "fallback"
  }
}

module.exports = resolveDomain
