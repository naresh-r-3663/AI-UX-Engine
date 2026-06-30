const generateSlotChildren = require("../ai/slotGenerator")
const { resolveComponentKey } = require("../engine/componentKeyLoader")

function buildContentSlotNode(step, mappedFields){
  const children = generateSlotChildren(step.contentSlot, mappedFields, { screen: step })
  const node = {
    type: "INSTANCE",
    name: step.contentSlot,
    componentKey: resolveComponentKey(step.contentSlot),
    componentName: step.contentSlot,
    children
  }

  if(step.subSlot){
    node.children = node.children.concat({
      type: "INSTANCE",
      name: step.subSlot,
      componentKey: resolveComponentKey(step.subSlot),
      componentName: step.subSlot,
      children: generateSlotChildren(step.subSlot, mappedFields, { screen: step })
    })
  }

  return node
}

function buildWizardHeaderNode(step) {
  if (!step._wizardStep) return null
  var isFirst = step._wizardStep === 1
  var subText = step._wizardSubText || step._newCardName || null
  var titleText = (step._formContext && step._formContext.formTitle) || step._prompt || null

  return {
    type: "INSTANCE",
    name: "wizard.header",
    componentKey: null,
    componentName: "wizard.header",
    meta: {
      variantState: isFirst ? "first.screen" : "type2",
      wizardTitle: titleText,
      wizardSubText: isFirst ? null : subText
    }
  }
}

function buildWizardNavChildren(step) {
  if (!step._wizardStep || !step._wizardTotal || !step._wizardLabels) return null
  var currentStep = step._wizardStep
  var total = step._wizardTotal
  var labels = step._wizardLabels

  var children = []
  for (var i = 0; i < total; i++) {
    var stepState = "default"
    if (i + 1 < currentStep) stepState = "completed"
    else if (i + 1 === currentStep) stepState = "active"

    children.push({
      type: "SLOT_INSTRUCTION",
      role: "stepper",
      name: labels[i] || ("Step " + (i + 1)),
      stepState: stepState,
      label: labels[i] || ("Step " + (i + 1)),
      meta: { index: i }
    })
  }
  return {
    type: "INSTANCE",
    name: "slot.wizard.nav",
    componentKey: null,
    componentName: "slot.wizard.nav",
    children: children
  }
}

function buildModuleSlotNode(step, mappedFields){
  const node = {
    type: "INSTANCE",
    name: step.moduleSlot,
    componentKey: resolveComponentKey(step.moduleSlot),
    componentName: step.moduleSlot,
    children: [buildContentSlotNode(step, mappedFields)]
  }

  // Attach form text overrides as meta when this is a form module
  if ((step.moduleSlot === "slot.module.form" || step.moduleSlot === "slot.module.wizardform") && step._formContext) {
    const ctx = step._formContext
    const isFilled = step.step === "filledForm"
    node.meta = {
      formTitle: (ctx.formTitle || ctx.formTitleFilled) || null,
      ctaText: ctx.ctaText || null,
      hintText: ctx.hintText || null
    }
  }

  // Wizard back button visibility via childOverrides on module slot
  if (step._wizardStep && step.moduleSlot === "slot.module.wizardform") {
    var hideBack = step._wizardHideBack !== undefined ? step._wizardHideBack : (step._wizardStep === 1)
    if (!node.childOverrides) node.childOverrides = []
    node.childOverrides.push({
      childName: "comp.huegrey.button",
      property: "visible",
      value: !hideBack
    })
  }

  // Attach selected item info as meta for details modules (card and table)
  if ((step.moduleSlot === "slot.module.details.card" || step.moduleSlot === "slot.module.details.table") && step._newCardName) {
    const appName = step._newCardName
    const words = String(appName).trim().split(/\s+/).filter(Boolean)
    const appIcon = words.length <= 1
      ? (words[0] || "").slice(0, 3).toUpperCase()
      : words.map(w => w[0]).join("").toUpperCase().slice(0, 3)
    const PEOPLE_KEYWORDS = ["user","users","people","person","member","employee","staff","team","customer","client"]
    const promptWords = String(step._prompt || "").toLowerCase().split(/\W+/).filter(Boolean)
    const isPeople = promptWords.some(function(w) { return PEOPLE_KEYWORDS.indexOf(w) !== -1 })
    const avatarConfig = isPeople
      ? { type: "Image", borderRadius: "Default", statusHint: true, color: null, userVariant: "Dev" }
      : { type: "Solid", borderRadius: "Default", statusHint: false, color: "Cardinal", userVariant: null }
    node.meta = { selectedCardName: appName, selectedCardIcon: appIcon, avatarConfig: avatarConfig }
  }

  return node
}

function buildToastNode(step){
  const node = {
    type: "INSTANCE",
    name: "comp.toast.message",
    componentKey: resolveComponentKey("comp.toast.message"),
    componentName: "comp.toast.message"
  }
  if (step && step.toastOverrides && step.toastOverrides.length) {
    node.childOverrides = step.toastOverrides
  }
  return node
}

function buildOverlaySlotNode(slotName, step){
  const node = {
    type: "INSTANCE",
    name: slotName,
    componentKey: resolveComponentKey(slotName),
    componentName: slotName
  }
  if (step && step.overlayChildOverrides && step.overlayChildOverrides.length) {
    node.childOverrides = step.overlayChildOverrides
  }
  return node
}

// Composed overlay: modal.blanket (full-screen) + slot.overlay.popup (centered)
function buildComposedOverlayNodes(step, mappedFields){
  const blanket = {
    type: "INSTANCE",
    name: "modal.blanket",
    componentKey: resolveComponentKey("modal.blanket"),
    componentName: "modal.blanket"
  }
  const popup = {
    type: "INSTANCE",
    name: step.overlaySlot,
    componentKey: resolveComponentKey(step.overlaySlot),
    componentName: step.overlaySlot
  }
  if (step.overlaySlot === "slot.overlay.popup" && Array.isArray(mappedFields) && mappedFields.length) {
    popup.children = [{
      type: "INSTANCE",
      name: "slot.content.form",
      componentKey: resolveComponentKey("slot.content.form"),
      componentName: "slot.content.form",
      children: generateSlotChildren("slot.content.form", mappedFields, { screen: step })
    }]
  }
  if (step && step.overlayChildOverrides && step.overlayChildOverrides.length) {
    popup.childOverrides = step.overlayChildOverrides
  }
  return [blanket, popup]
}

function buildLayout(step, mappedFields = []){
  const children = [buildModuleSlotNode(step, mappedFields)]

  // Wizard header + nav + back button visibility as siblings
  var wizardHeader = buildWizardHeaderNode(step)
  if (wizardHeader) children.push(wizardHeader)

  var wizardNav = buildWizardNavChildren(step)
  if (wizardNav) children.push(wizardNav)

  // Wizard hint text (same hintText from form context)
  if (step._wizardStep && step._formContext && step._formContext.hintText) {
    children.push({
      type: "INSTANCE",
      name: "slot.wizard.hint",
      componentKey: null,
      componentName: "slot.wizard.hint",
      meta: { hintText: step._formContext.hintText }
    })
  }

  if(step.toast){
    children.push(buildToastNode(step))
  }

  if(step.overlayCompose && step.overlaySlot){
    buildComposedOverlayNodes(step, step._overlayFormFields || mappedFields).forEach(function(n){ children.push(n) })
  } else if(step.overlaySlot){
    children.push(buildOverlaySlotNode(step.overlaySlot, step))
  }

  return {
    name: step.name,
    base: step.base || "page.base",
    width: 1440,
    height: 900,
    children
  }
}

module.exports = buildLayout
