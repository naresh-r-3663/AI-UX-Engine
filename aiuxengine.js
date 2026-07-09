const fs           = require("fs")
const orchestrateApp = require("./orchestrator/appOrchestrator")
const applyPatch   = require("./engine/patchResolver")

const args = process.argv.slice(2)

// ─── Flags ────────────────────────────────────────────────────────────────────
const patchOnly = args.includes("--patch-only")
if (patchOnly) args.splice(args.indexOf("--patch-only"), 1)

// Support: --screen-list <file>
let screenListFile = null
const slIdx = args.indexOf("--screen-list")
if (slIdx !== -1 && args[slIdx + 1]) {
  screenListFile = args[slIdx + 1]
  args.splice(slIdx, 2)
}

// --patch-only defaults to screen-list.json
if (patchOnly && !screenListFile) screenListFile = "screen-list.json"

// ─── Read screen list ─────────────────────────────────────────────────────────
let prompt  = ""
let screens = null

if (screenListFile) {
  try {
    const slData = JSON.parse(fs.readFileSync(screenListFile, "utf8"))
    prompt  = slData.prompt  || ""
    screens = slData.screens || null
  } catch (err) {
    console.error("Failed to read screen-list file:", screenListFile, err.message)
    process.exit(1)
  }
}

// CLI prompt overrides file prompt
const rawPrompt = process.env.PROMPT || args.join(" ")
if (rawPrompt.trim()) prompt = rawPrompt.trim()

if (!patchOnly && !prompt) {
  console.log("Please provide a prompt.")
  process.exit(1)
}

const renderTool    = process.env.RENDER_TOOL || "json"
const RENDER_OUTPUT = "./render-output.json"

// ─── Patcher pass ─────────────────────────────────────────────────────────────
async function runPatcher(frames) {
  const screensWithPatch = (screens || []).filter(function(s) { return s.patch })
  if (!screensWithPatch.length) return frames

  console.log(`[Patcher] Applying patches to ${screensWithPatch.length} screen(s)...`)

  for (const screen of screensWithPatch) {
    const frame = frames.find(function(f) { return f.name === screen.name })
    if (!frame) {
      console.warn(`[Patcher] SKIPPED "${screen.name}": frame not found in render-output.json`)
      continue
    }
    const result = await applyPatch(frame, screen.patch, screen.name)
    if (!result.skipped) {
      console.log(`[Patcher] "${screen.name}" — ${result.ops.length} op(s) applied`)
    }
  }

  return frames
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  let frames

  if (patchOnly) {
    // Pass 2 only — load existing render-output.json
    if (!fs.existsSync(RENDER_OUTPUT)) {
      console.error("[Patcher] render-output.json not found. Run a full render first (without --patch-only).")
      process.exit(1)
    }
    frames = JSON.parse(fs.readFileSync(RENDER_OUTPUT, "utf8"))
    console.log(`[Patcher] Loaded ${frames.length} frame(s) from render-output.json`)
  } else {
    // Pass 1 — full render
    const result = await orchestrateApp(prompt, { renderTool, screens })
    frames = result.frames || result

    if (renderTool === "json") {
      fs.writeFileSync(RENDER_OUTPUT, JSON.stringify(frames, null, 2))
      console.log("Render JSON written to render-output.json")
    } else {
      console.log(JSON.stringify(frames, null, 2))
      return
    }
  }

  // Pass 2 — apply patches (runs after both full render and --patch-only)
  frames = await runPatcher(frames)

  const screensWithPatch = (screens || []).filter(function(s) { return s.patch })
  if (screensWithPatch.length) {
    fs.writeFileSync(RENDER_OUTPUT, JSON.stringify(frames, null, 2))
    console.log("[Patcher] render-output.json updated with patches")
  }
}

run().catch(function(error) {
  console.error("Failed to run AI UX engine:", error)
  process.exit(1)
})
