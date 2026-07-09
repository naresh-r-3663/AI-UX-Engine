const resolveDomain = require("../engine/domainResolver")
const { shouldUseAI } = require("../engine/runModeResolver")
const generateFlow = require("../ai/flowGenerator")
const resolveScreens = require("../engine/screenResolver")
const resolveFields = require("../engine/fieldResolver")
const { mapFields } = require("../engine/componentMapper")
const buildLayout = require("../builder/layoutBuilder")
const buildJson = require("../builder/jsonBuilder")
const figmaRenderer = require("../renderer/figmaRenderer")
const resolveItemNames = require("../ai/itemNameResolver")
const resolveContext = require("../ai/contextResolver")
const { randomCreatedOn } = require("../ai/slotGenerator")

async function run(prompt, options = {}){
  const domain = resolveDomain(prompt)
  const useAI = shouldUseAI(prompt, domain)
  const aiConfig = options.aiConfig

  // If an explicit screens list is provided, use screenResolver — otherwise fall back to flowGenerator
  const flowSteps = (options.screens && options.screens.length)
    ? await resolveScreens(options.screens, domain.title || "Screen", aiConfig)
    : generateFlow(prompt, domain)

  const baseFormFields = await resolveFields(prompt, domain, { step: "form", useAI, aiConfig })

  // Pre-resolve card names once for all dashboard/table steps (shared pool)
  const hasDashboardStep = flowSteps.some(s => s.step === "dashboard")
  const hasTableStep = flowSteps.some(s => s.step === "table")
  // Use saved card names from domain model if available, otherwise resolve fresh
  const hasSavedCardNames = Array.isArray(domain.cardNames) && domain.cardNames.length > 0
  const _cardNames = (hasDashboardStep || hasTableStep)
    ? (hasSavedCardNames ? domain.cardNames.slice(0, 16) : await resolveItemNames(prompt, 16, { useAI, aiConfig }))
    : null

  // New card name = first resolved card name (same value that fills frame 03's primary name field)
  const _newCardName = (_cardNames && _cardNames.length) ? _cardNames[0] : null

  // Pre-generate dates once so all screens share the same date per card
  const _cardDates = _cardNames ? _cardNames.map(() => randomCreatedOn()) : null

  // Pre-resolve form context texts once for all form steps (shared values)
  const hasFormStep = flowSteps.some(s => s.step === "form" || s.step === "filledForm")
  const _formContext = hasFormStep ? await resolveContext(prompt, domain, { useAI, aiConfig }) : null

  // Collect field categories from explicit fields for domain candidate
  const _fieldCategories = {}

  const layouts = await Promise.all(
    flowSteps.map(async step => {
      let fields = []

      if (step._explicitFields && step._explicitFields.length) {
        // Priority 1: explicit fields in screen-list.json
        fields = step._explicitFields
        if (step._fieldCategory) _fieldCategories[step._fieldCategory] = fields
      } else if (step._fieldCategory && domain.fieldCategories && domain.fieldCategories[step._fieldCategory]) {
        // Priority 2: saved field category from domain knowledge
        fields = domain.fieldCategories[step._fieldCategory]
      } else if(step.step === "form" || step.step === "filledForm"){
        // Priority 3: flat base form fields (AI-resolved or domain)
        fields = baseFormFields
        if (step._fieldCategory) _fieldCategories[step._fieldCategory] = fields
      } else {
        fields = await resolveFields(prompt, domain, { ...step, useAI, aiConfig })
      }

      const mappedFields = mapFields(fields)
      const _overlayFormFields = step.overlayCompose && step.overlaySlot ? mapFields(baseFormFields) : null
      return buildLayout({ ...step, _prompt: prompt, _cardNames, _cardDates, _newCardName, _formContext, _overlayFormFields }, mappedFields)
    })
  )

  const frames = buildJson(layouts)
  const renderedFrames = figmaRenderer(frames, { mode: options.renderTool || "json" })

  // Build domain model candidate for AI-generated flows (any AI call, not just fallback)
  let domainModelCandidate = null
  if (useAI) {
    const FLOW_WORDS = ["dashboard", "grid", "app", "application", "form", "page", "list", "table", "view", "screen", "ui", "flow", "management", "manage"]
    const promptWords = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
    const meaningfulWords = promptWords.filter(w => !FLOW_WORDS.includes(w) && w.length > 1)
    const candidateKey = meaningfulWords.join("_") || domain.name || "custom"

    domainModelCandidate = {
      key: candidateKey,
      entity: (_formContext && _formContext.subject) || domain.title || candidateKey,
      keywords: meaningfulWords.length ? meaningfulWords : [candidateKey],
      texts: _formContext ? {
        ctaText: _formContext.ctaText || null,
        ctaIcon: _formContext.ctaIcon || null,
        headerText: _formContext.headerText || null,
        headerDescription: _formContext.headerDescription || null
      } : {},
      fields: baseFormFields.map(f => ({ label: f.label, type: f.type })),
      fieldCategories: Object.keys(_fieldCategories).length ? _fieldCategories : null,
      cardNames: _cardNames || []
    }
  }

  return { frames: renderedFrames, domainModelCandidate }
}

module.exports = run
