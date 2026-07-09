const path = require("path")
const fs   = require("fs")

const moduleRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "moduleRegistry.json"), "utf8"))
let   screenRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "screenRegistry.json"), "utf8"))
const actionMenuReg  = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "actionMenuRegistry.json"), "utf8"))
const engineConfig   = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "engineConfig.json"), "utf8"))
const resolveWithAI           = require("./aiScreenResolver")
const { resolveOverrideSentinels } = require("./propertyResolver")

// Normalise a string for loose matching: lowercase, collapse spaces/punctuation
function normalise(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

// Write an AI-resolved entry back to screenRegistry.json
function learnToRegistry(screenDesc, props) {
  const cfg = engineConfig.registry || {}
  if (!cfg.autoLearn) return

  const entry = { ...props, _source: "ai-learned" }

  if (cfg.requireConfirm) {
    console.log(`\n[AI Resolver] New screen: "${screenDesc}"`)
    console.log(`Suggested registry entry:`)
    console.log(JSON.stringify({ [screenDesc]: entry }, null, 2))
    console.log(`Add to config/screenRegistry.json to cache this.\n`)
    return
  }

  screenRegistry[screenDesc] = entry
  const registryPath = path.join(__dirname, "..", "config", "screenRegistry.json")
  fs.writeFileSync(registryPath, JSON.stringify(screenRegistry, null, 2))
  console.log(`[AI Resolver] Learned: "${screenDesc}" → saved to registry`)
}

// Find matching screen registry entry, or call AI on miss
async function resolveScreenProps(screenDesc, moduleKey, aiConfig) {
  const needle = normalise(screenDesc)

  // 1. Exact match
  for (const key of Object.keys(screenRegistry)) {
    if (normalise(key) === needle) return screenRegistry[key]
  }

  // 2. Best token-overlap match
  let bestKey   = null
  let bestScore = 0
  const needleTokens = new Set(needle.split(" ").filter(Boolean))

  for (const key of Object.keys(screenRegistry)) {
    const keyTokens = normalise(key).split(" ").filter(Boolean)
    const overlap   = keyTokens.filter(t => needleTokens.has(t)).length
    const score     = overlap / Math.max(keyTokens.length, needleTokens.size)
    if (score > bestScore) { bestScore = score; bestKey = key }
  }

  if (bestKey && bestScore >= 0.5) return screenRegistry[bestKey]

  // 3. AI resolve on miss
  console.log(`[AI Resolver] No registry match for "${screenDesc}" — calling AI...`)
  const aiProps = await resolveWithAI(screenDesc, moduleKey, aiConfig)
  if (aiProps && Object.keys(aiProps).filter(k => k !== "_source").length > 0) {
    learnToRegistry(screenDesc, aiProps)
    return aiProps
  }

  // 4. Fallback — default screen
  return {}
}

// Build childOverrides for menu item hover
function buildMenuChildOverrides(menuItemHover) {
  if (!menuItemHover) return null
  const items    = actionMenuReg.items || []
  const hoverIdx = items.findIndex(i => normalise(i) === normalise(menuItemHover))
  if (hoverIdx === -1) return null

  return items.map((itemName, idx) => ({
    childName: itemName,
    component: "dropdown.overlay.list.item",
    property:  "Status",
    value:     idx === hoverIdx ? actionMenuReg.hoverStatus : actionMenuReg.defaultStatus
  }))
}

// Resolve a single screen entry → step object
async function resolveScreen(screenEntry, domainTitle, index, aiConfig) {
  const moduleKey = normalise(screenEntry.module)
  const moduleDef = moduleRegistry[moduleKey] || moduleRegistry["dashboard"]

  const screenProps = await resolveScreenProps(screenEntry.screen || "default", moduleKey, aiConfig)
  const screenName  = screenEntry.name || `${String(index + 1).padStart(2, "0")} ${domainTitle} - ${screenEntry.screen || "default"}`

  const step = {
    id:          screenEntry.id || `screen-${index}`,
    name:        screenName,
    moduleSlot:  moduleDef.moduleSlot,
    contentSlot: moduleDef.contentSlot,
    step:        screenProps.step || moduleDef.step,
    base:        screenEntry.base || moduleDef.base || "page.base",
    ...(screenEntry.fields          ? { _explicitFields:  screenEntry.fields }          : {}),
    ...(screenEntry.fieldCategory   ? { _fieldCategory:   screenEntry.fieldCategory }   : {}),
    ...(screenEntry.wizardStep      ? { _wizardStep:      screenEntry.wizardStep }      : {}),
    ...(screenEntry.wizardTotal     ? { _wizardTotal:     screenEntry.wizardTotal }     : {}),
    ...(screenEntry.wizardLabels    ? { _wizardLabels:    screenEntry.wizardLabels }    : {}),
    ...(screenEntry.wizardSubText   ? { _wizardSubText:  screenEntry.wizardSubText }   : {}),
    ...(screenEntry.wizardHideBack !== undefined ? { _wizardHideBack: screenEntry.wizardHideBack } : {}),
    ...(moduleDef.subSlot           ? { subSlot:         moduleDef.subSlot }           : {}),
    ...(screenProps.toast           ? { toast:            true }                        : {}),
    ...(screenProps.cardState       ? { cardState:        screenProps.cardState }       : {}),
    ...(screenProps.rowState        ? { rowState:         screenProps.rowState }        : {}),
    ...(screenProps.inputState      ? { inputState:       screenProps.inputState }      : {}),
    ...(screenProps.overlaySlot     ? { overlaySlot:      screenProps.overlaySlot }     : {}),
    ...(screenProps.overlayCompose  ? { overlayCompose:   true }                         : {}),
    ...(screenProps.toastOverrides       ? { toastOverrides:       screenProps.toastOverrides }       : {}),
    ...(screenProps.childOverrides       ? { childOverrides:       screenProps.childOverrides }       : {}),
    ...(screenProps.rowChildOverrides    ? { rowChildOverrides:    screenProps.rowChildOverrides }    : {}),
    ...(screenProps.overlayChildOverrides ? { overlayChildOverrides: screenProps.overlayChildOverrides } : {})
  }

  const menuOverrides = buildMenuChildOverrides(screenProps.menuItemHover)
  if (menuOverrides) step.childOverrides = menuOverrides

  // Resolve $hover sentinels → exact property/value using componentPropertyMap
  if (step.overlayChildOverrides) step.overlayChildOverrides = resolveOverrideSentinels(step.overlayChildOverrides)
  if (step.childOverrides)        step.childOverrides        = resolveOverrideSentinels(step.childOverrides)
  if (step.rowChildOverrides)     step.rowChildOverrides     = resolveOverrideSentinels(step.rowChildOverrides)
  if (step.toastOverrides)        step.toastOverrides        = resolveOverrideSentinels(step.toastOverrides)

  return step
}

// Resolve a full screens array → array of step objects
async function resolveScreens(screens, domainTitle, aiConfig) {
  return Promise.all(
    (screens || []).map((entry, i) => resolveScreen(entry, domainTitle, i, aiConfig))
  )
}

module.exports = resolveScreens
