const http = require("http")
const fs = require("fs")
const path = require("path")

const runOrchestrator = require("../orchestrator/appOrchestrator")
const applyPatch = require("../engine/patchResolver")
const resolveDomain = require("../engine/domainResolver")
const { shouldUseAI } = require("../engine/runModeResolver")

const HOST = process.env.UI_HOST || "127.0.0.1"
const PORT = Number(process.env.UI_PORT || 3210)
const UI_FILE = path.join(__dirname, "..", "prompt-ui.html")
const README_FILE = path.join(__dirname, "..", "engine-readme.html")
const DOMAIN_MODELS_PATH = path.join(__dirname, "..", "config", "domainModels.json")

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  })
  res.end(body)
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store"
  })
  res.end(html)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", chunk => {
      raw += chunk
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"))
      }
    })
    req.on("end", () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(new Error("Invalid JSON body"))
      }
    })
    req.on("error", reject)
  })
}

function getRunMode(prompt) {
  const domain = resolveDomain(prompt)
  const useAI = shouldUseAI(prompt, domain)
  return {
    domain,
    useAI,
    mode: useAI ? "ai" : "knowledge"
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function handleMode(req, res) {
  const body = await readJsonBody(req)
  const prompt = String(body?.prompt || "").trim()
  if (!prompt) {
    return sendJson(res, 400, { error: "Prompt is required" })
  }

  const result = getRunMode(prompt)
  sendJson(res, 200, result)
}

async function handleGenerate(req, res) {
  const body = await readJsonBody(req)
  const prompt = String(body?.prompt || "").trim()
  if (!prompt) {
    return sendJson(res, 400, { error: "Prompt is required" })
  }

  const aiConfig = body?.aiConfig || null
  const modeResult = getRunMode(prompt)

  if (modeResult.mode === "knowledge") {
    await sleep(1200)
  }

  const result = await runOrchestrator(prompt, { renderTool: "json", aiConfig })
  const frames = result.frames || result
  const domainModelCandidate = result.domainModelCandidate || null
  const screenNames = (Array.isArray(frames) ? frames : []).map(f => f.name)

  sendJson(res, 200, {
    prompt,
    ...modeResult,
    summary: {
      screens: screenNames.length,
      flow: screenNames.length >= 6 ? "6-step UX flow" : `${screenNames.length}-step UX flow`
    },
    screenNames,
    frames,
    domainModelCandidate
  })
}

// ---------- Screen List Render ----------

const RENDER_OUTPUT = path.join(__dirname, "..", "render-output.json")

async function handleRenderScreens(req, res) {
  const body = await readJsonBody(req)
  const prompt = String(body?.prompt || "").trim()
  const screens = Array.isArray(body?.screens) ? body.screens : null
  const patchOnly = !!body?.patchOnly
  const aiConfig = body?.aiConfig || null

  if (!prompt && !patchOnly) {
    return sendJson(res, 400, { error: "prompt is required" })
  }
  if (!screens || !screens.length) {
    return sendJson(res, 400, { error: "screens array is required" })
  }

  let frames
  let domainModelCandidate = null

  if (patchOnly) {
    if (!fs.existsSync(RENDER_OUTPUT)) {
      return sendJson(res, 400, { error: "render-output.json not found. Run Full Generate first." })
    }
    frames = JSON.parse(fs.readFileSync(RENDER_OUTPUT, "utf8"))
  } else {
    const result = await runOrchestrator(prompt, { renderTool: "json", screens, aiConfig })
    frames = result.frames || result
    domainModelCandidate = result.domainModelCandidate || null
    fs.writeFileSync(RENDER_OUTPUT, JSON.stringify(frames, null, 2))
  }

  // Apply patches
  const screensWithPatch = screens.filter(function(s) { return s.patch })
  if (screensWithPatch.length) {
    for (const screen of screensWithPatch) {
      const frame = frames.find(function(f) { return f.name === screen.name })
      if (!frame) continue
      await applyPatch(frame, screen.patch, screen.name, aiConfig)
    }
    fs.writeFileSync(RENDER_OUTPUT, JSON.stringify(frames, null, 2))
  }

  const screenNames = frames.map(function(f) { return f.name })
  const modeResult = getRunMode(prompt)

  sendJson(res, 200, {
    prompt,
    ...modeResult,
    summary: {
      screens: screenNames.length,
      flow: screenNames.length + "-screen flow" + (patchOnly ? " (patch only)" : "")
    },
    screenNames,
    frames,
    domainModelCandidate
  })
}

// ---------- Domain Model Save / List ----------

let _saveLock = false
async function acquireLock() {
  while (_saveLock) await new Promise(r => setTimeout(r, 50))
  _saveLock = true
}
function releaseLock() { _saveLock = false }

function readDomainModels() {
  try {
    return JSON.parse(fs.readFileSync(DOMAIN_MODELS_PATH, "utf8"))
  } catch {
    return {}
  }
}

function writeDomainModels(data) {
  fs.writeFileSync(DOMAIN_MODELS_PATH, JSON.stringify(data, null, 2))
}

function purgeExpiredDomains() {
  const data = readDomainModels()
  let changed = false
  for (const key of Object.keys(data)) {
    const meta = data[key]?._meta
    if (meta && meta.expiresAt && new Date(meta.expiresAt) < new Date()) {
      delete data[key]
      changed = true
    }
  }
  if (changed) writeDomainModels(data)
}

async function handleSaveDomain(req, res) {
  const body = await readJsonBody(req)
  const { key, entity, keywords, texts, fields, fieldCategories, cardNames, expiry, priority, originalPrompt } = body

  if (!key || typeof key !== "string") {
    return sendJson(res, 400, { error: "key is required" })
  }

  await acquireLock()
  try {
  const data = readDomainModels()

  // Calculate expiry date
  let expiresAt = null
  if (expiry && typeof expiry === "number" && expiry > 0) {
    const d = new Date()
    d.setDate(d.getDate() + expiry)
    expiresAt = d.toISOString()
  }

  const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
  const exists = !!data[sanitizedKey]

  // Merge exactPrompts: keep existing ones and add the original prompt (normalized)
  const existingExact = exists ? (data[sanitizedKey].exactPrompts || []) : []
  const promptToSave = String(originalPrompt || "").trim().toLowerCase()
  const normalizedExisting = existingExact.map(p => String(p).trim().toLowerCase())
  const mergedExact = [...new Set([...normalizedExisting, ...(promptToSave ? [promptToSave] : [])])]

  // Merge strategy: keep existing fields/texts if new save has empty data
  const existing = exists ? data[sanitizedKey] : null
  const newFields = Array.isArray(fields) && fields.length > 0 ? fields : (existing?.fields || [])
  const newTexts = (texts && Object.values(texts).some(Boolean)) ? texts : (existing?.texts || {})
  const newKeywords = Array.isArray(keywords) && keywords.length > 0 ? keywords : (existing?.keywords || [sanitizedKey])

  const newCardNames = Array.isArray(cardNames) && cardNames.length > 0 ? cardNames : (existing?.cardNames || [])
  const newFieldCategories = (fieldCategories && typeof fieldCategories === "object" && Object.keys(fieldCategories).length > 0)
    ? fieldCategories : (existing?.fieldCategories || null)

  data[sanitizedKey] = {
    entity: entity || (existing?.entity) || sanitizedKey,
    keywords: newKeywords,
    exactPrompts: mergedExact,
    texts: newTexts,
    fields: newFields,
    ...(newFieldCategories ? { fieldCategories: newFieldCategories } : {}),
    cardNames: newCardNames,
    _meta: {
      priority: typeof priority === "number" ? priority : 1,
      expiresAt,
      savedAt: new Date().toISOString(),
      source: "auto-saved"
    }
  }

  writeDomainModels(data)
  sendJson(res, 200, { saved: true, key: sanitizedKey, overwritten: exists })
  } finally {
    releaseLock()
  }
}

async function handleListDomains(req, res) {
  const data = readDomainModels()
  const list = Object.entries(data).map(([key, val]) => ({
    key,
    entity: val.entity,
    keywords: val.keywords,
    _meta: val._meta || null
  }))
  sendJson(res, 200, { domains: list })
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`)

    if (req.method === "GET" && url.pathname === "/") {
      const html = fs.readFileSync(UI_FILE, "utf8")
      return sendHtml(res, 200, html)
    }

    if (req.method === "GET" && url.pathname === "/engine-readme.html") {
      const html = fs.readFileSync(README_FILE, "utf8")
      return sendHtml(res, 200, html)
    }

    if (req.method === "POST" && url.pathname === "/api/mode") {
      return await handleMode(req, res)
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      return await handleGenerate(req, res)
    }

    if (req.method === "POST" && url.pathname === "/api/render-screens") {
      return await handleRenderScreens(req, res)
    }

    if (req.method === "POST" && url.pathname === "/api/save-domain") {
      return await handleSaveDomain(req, res)
    }

    if (req.method === "GET" && url.pathname === "/api/list-domains") {
      return await handleListDomains(req, res)
    }

    sendJson(res, 404, { error: "Not found" })
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" })
  }
})

// Purge expired domain models on startup
purgeExpiredDomains()

server.listen(PORT, HOST, () => {
  console.log(`Prompt UI running at http://${HOST}:${PORT}`)
})
