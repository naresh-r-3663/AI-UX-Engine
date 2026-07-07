let componentKeyMap = null
let componentNodeMap = null

function ensureComponentMaps() {
  if (componentKeyMap && componentNodeMap) return
  const keyMap = Object.create(null)
  const nodeMap = Object.create(null)
  const components = figma.root.findAll(
    n => n.type === "COMPONENT" || n.type === "COMPONENT_SET"
  )
  for (const node of components) {
    if (node && node.name) {
      nodeMap[node.name] = node
      const lower = String(node.name).toLowerCase()
      if (!nodeMap[lower]) {
        nodeMap[lower] = node
      }
    }
    if (node && node.name && node.key) {
      keyMap[node.name] = node.key
      const lower = String(node.name).toLowerCase()
      if (!keyMap[lower]) {
        keyMap[lower] = node.key
      }
    }
  }

  // Index slot frames and page base frames — local FRAME/GROUP nodes, not components
  const localFrames = figma.root.findAll(
    n => (n.type === "FRAME" || n.type === "GROUP") &&
      (String(n.name || "").startsWith("slot.") || String(n.name || "").startsWith("page."))
  )
  for (const node of localFrames) {
    if (node && node.name) {
      nodeMap[node.name] = node
      const lower = String(node.name).toLowerCase()
      if (!nodeMap[lower]) nodeMap[lower] = node
    }
  }

  componentKeyMap = keyMap
  componentNodeMap = nodeMap
}

function buildComponentKeyMap() {
  ensureComponentMaps()
  return componentKeyMap
}

function buildComponentNodeMap() {
  ensureComponentMaps()
  return componentNodeMap
}

function getComponentKeyByName(name) {
  if (!componentKeyMap) {
    componentKeyMap = buildComponentKeyMap()
  }
  return componentKeyMap[name] || componentKeyMap[String(name || "").toLowerCase()]
}

function getComponentNodeByName(name) {
  if (!componentNodeMap) {
    componentNodeMap = buildComponentNodeMap()
  }
  return componentNodeMap[name] || componentNodeMap[String(name || "").toLowerCase()]
}

figma.showUI(__html__, { width: 400, height: 600 })

let nextX = 0
const FRAME_GAP = 100

figma.ui.onmessage = async (msg) => {

  if (msg.type !== "render") return

  if (msg.resetLayout) {
    nextX = 0
  }

  let json

  try {
    json = JSON.parse(msg.json)
  } catch (err) {
    figma.notify("Invalid JSON")
    return
  }

  const created = await renderUI(json)

  if (created && created.length) {
    for (const node of created) {
      node.x = nextX
      node.y = 0
      nextX += node.width + FRAME_GAP
    }
    figma.viewport.scrollAndZoomIntoView(created)
  }

}


function getNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function normalizePropName(name) {
  return String(name || "").toLowerCase()
}

function normalizeName(name) {
  return String(name || "").toLowerCase()
}

// When a component doesn't have the exact variant name,
// try these alternatives in order before falling back to defaultVariant.
const VARIANT_SYNONYMS = {
  "filled":   ["selected", "chosen"],
  "selected": ["filled"],
  "active":   ["focused", "focus"],
  "focused":  ["active"],
  "disabled": ["disabled after"]
}

function pickVariantFromSet(componentSet, data) {
  const meta = (data && data.meta) || {}
  const variantState = meta.variantState !== undefined && meta.variantState !== null
    ? meta.variantState
    : (meta.state !== undefined && meta.state !== null
      ? meta.state
      : (data && data.variantState))
  if (!variantState || !componentSet || componentSet.type !== "COMPONENT_SET") {
    return componentSet && componentSet.defaultVariant
  }

  // Normalize: lowercase + treat hyphens and spaces as equivalent (DS uses mixed conventions)
  const norm = function(s) { return String(s).toLowerCase().replace(/[-\s]+/g, "-") }
  const needle = norm(variantState)
  const synonyms = VARIANT_SYNONYMS[needle] || VARIANT_SYNONYMS[String(variantState).toLowerCase()] || []
  const candidates = [needle, ...synonyms.map(norm)]

  for (const candidate of candidates) {
    for (const child of componentSet.children) {
      if (child && child.type === "COMPONENT") {
        // Parse "State=Selected, Size=Base" → normalized values
        // Exact value match prevents "Hover On Selected" from matching "selected"
        const values = String(child.name || "").split(",").map(function(part) {
          var eqIdx = part.indexOf("=")
          return eqIdx !== -1
            ? norm(part.slice(eqIdx + 1).trim())
            : norm(part.trim())
        })
        if (values.some(function(v) { return v === candidate })) {
          return child
        }
      }
    }
  }
  return componentSet.defaultVariant
}

async function resolveComponentForData(name, data, componentMap) {
  const resolvedName = name === "comp.toast.icon.success" ? "comp.toast.message" : name
  const localNode = getComponentNodeByName(resolvedName)
  if (localNode) {
    if (localNode.type === "COMPONENT_SET") {
      return pickVariantFromSet(localNode, data)
    }
    return localNode
  }
  const key = componentMap[resolvedName] || componentMap[normalizeName(resolvedName)]
  if (!key) return null
  try {
    return await figma.importComponentByKeyAsync(key)
  } catch (err) {
    return null
  }
}

function findDirectInstanceByName(frame, targetName) {
  const key = normalizeName(targetName)
  return frame.children.find(
    n => n.type === "INSTANCE" && normalizeName(n.name) === key
  )
}

function applyFrameLayout(frame) {
  if (!frame || frame.type !== "FRAME") return
  const width = frame.width
  const height = frame.height

  // Use module.placeholder's position/size if available (from page.base clone)
  const placeholder = frame.findOne(n => n.name === "module.placeholder")

  // Position module slot in the content area (right of nav, below topbar)
  const moduleSlot = frame.children.find(
    n => String(n.name || "").startsWith("slot.module.")
  )
  if (moduleSlot) {
    const slotX = (placeholder && Number.isFinite(placeholder.x)) ? placeholder.x : 225
    const slotY = (placeholder && Number.isFinite(placeholder.y)) ? placeholder.y : 48
    const slotW = (placeholder && Number.isFinite(placeholder.width)) ? placeholder.width : (width - slotX)
    const slotH = (placeholder && Number.isFinite(placeholder.height)) ? placeholder.height : (height - slotY)
    moduleSlot.x = slotX
    moduleSlot.y = slotY
    try {
      moduleSlot.resizeWithoutConstraints(slotW, slotH)
    } catch (_) {}
  }

  // Position toast overlay: centered horizontally, 60px from top
  const toast = frame.children.find(n => n.name === "comp.toast.message")
  if (toast) {
    toast.x = Math.max(0, (width - toast.width) / 2)
    toast.y = 60
  }

  // modal.blanket: full-frame at (0, 0) — transparent background for composed overlays
  const blanket = frame.children.find(function(n) { return n.name === "modal.blanket" })
  if (blanket) {
    blanket.x = 0
    blanket.y = 0
    try { blanket.resizeWithoutConstraints(width, height) } catch (_) {}
  }

  // Any slot.overlay.*: composed (has blanket sibling) → center; legacy → full-frame
  const hasBlanket = !!blanket
  for (const child of frame.children) {
    if (!String(child.name || "").startsWith("slot.overlay.")) continue
    if (hasBlanket) {
      // Composed overlay — centered horizontally, 100px from top, keeps its own size
      child.x = Math.max(0, (width - child.width) / 2)
      child.y = 100
    } else {
      // Legacy full-frame overlay — pin to (0, 0) and fill page
      child.x = 0
      child.y = 0
      try { child.resizeWithoutConstraints(width, height) } catch (_) {}
    }
  }
}

async function resolveComponentForSwap(name, componentMap) {
  const resolvedName = name === "comp.toast.icon.success" ? "comp.toast.message" : name
  const localNode = getComponentNodeByName(resolvedName)
  if (localNode) {
    if (localNode.type === "COMPONENT_SET") {
      return localNode.defaultVariant
    }
    return localNode
  }
  const key = componentMap[resolvedName] || componentMap[normalizeName(resolvedName)]
  if (!key) return null
  try {
    return await figma.importComponentByKeyAsync(key)
  } catch (err) {
    return null
  }
}

// ─── Named Variant / Property Overrides ──────────────────────────────────────
// Sets specific component properties by their display name (strips #id suffix).
// Handles VARIANT (string) and BOOLEAN (bool) property types.
function normalizeVariantValue(v) {
  return String(v).toLowerCase().replace(/[\s\-_]+/g, "")
}

function resolveVariantValue(instance, displayName, value) {
  try {
    const comp = instance.mainComponent
    if (comp && comp.parent && comp.parent.type === "COMPONENT_SET") {
      const group = comp.parent.variantGroupProperties[displayName]
      if (group && Array.isArray(group.values)) {
        if (group.values.includes(value)) return value
        const norm = normalizeVariantValue(value)
        const match = group.values.find(v => normalizeVariantValue(v) === norm)
        if (match !== undefined) return match
      }
    }
  } catch (_) {}
  return value
}

function applyNamedVariants(instance, propsMap) {
  if (!instance || !propsMap) return
  const props = instance.componentProperties
  if (!props) return
  for (const [key, prop] of Object.entries(props)) {
    const displayName = String(key).replace(/\s*#\d+:\d+$/, "").trim()
    // Exact match first, then case-insensitive fallback so "color" finds "Color"
    let value = propsMap[displayName]
    if (value === undefined) {
      const normDisplay = displayName.toLowerCase()
      for (const k of Object.keys(propsMap)) {
        if (k.toLowerCase() === normDisplay) { value = propsMap[k]; break }
      }
    }
    if (value === undefined) continue
    try {
      if (prop.type === "BOOLEAN") {
        instance.setProperties({ [key]: Boolean(value) })
      } else {
        const resolved = resolveVariantValue(instance, displayName, value)
        instance.setProperties({ [key]: resolved })
      }
    } catch (err) {
      console.warn("applyNamedVariants failed:", key, value, err)
    }
  }
}

// Smart hover: auto-detects whether component uses BOOLEAN "Hover" or VARIANT "State"/"Status"
// with a hover value — no need to know the component's internal structure at registry time.
function applyHoverToInstance(instance) {
  if (!instance || !instance.componentProperties) return
  const props = instance.componentProperties
  // Pass 1: prefer explicit BOOLEAN property named "hover"
  for (const [key, prop] of Object.entries(props)) {
    const displayName = String(key).replace(/\s*#\d+:\d+$/, "").trim()
    if (prop.type === "BOOLEAN" && displayName.toLowerCase() === "hover") {
      try { instance.setProperties({ [key]: true }) } catch (_) {}
      return
    }
  }
  // Pass 2: VARIANT property named "hover" with boolean-like values e.g. "True"/"False"
  // (comp.error.button and all comp.button.* use this pattern)
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type !== "VARIANT") continue
    const displayName = String(key).replace(/\s*#\d+:\d+$/, "").trim()
    if (displayName.toLowerCase() !== "hover") continue
    try {
      const comp = instance.mainComponent
      if (comp && comp.parent && comp.parent.type === "COMPONENT_SET") {
        const group = comp.parent.variantGroupProperties[displayName]
        if (group && Array.isArray(group.values)) {
          const trueVal = group.values.find(v => {
            const nv = normalizeVariantValue(v)
            return nv === "true" || nv === "yes" || nv === "on" || nv === "1"
          })
          if (trueVal) { instance.setProperties({ [key]: trueVal }); return }
        }
      }
    } catch (_) {}
  }
  // Pass 3: VARIANT "State" or "Status" whose values include a hover option
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type !== "VARIANT") continue
    const displayName = String(key).replace(/\s*#\d+:\d+$/, "").trim()
    const normDisplay = displayName.toLowerCase()
    if (normDisplay !== "state" && normDisplay !== "status") continue
    try {
      const comp = instance.mainComponent
      if (comp && comp.parent && comp.parent.type === "COMPONENT_SET") {
        const group = comp.parent.variantGroupProperties[displayName]
        if (group && Array.isArray(group.values)) {
          const hoverVal = group.values.find(v => normalizeVariantValue(v).startsWith("hover"))
          if (hoverVal) { instance.setProperties({ [key]: hoverVal }); return }
        }
      }
    } catch (_) {}
  }
}

// ─── Generic Child Override Applicator ───────────────────────────────────────
// Finds named child instances inside any INSTANCE and applies variant/property
// overrides. Works for toast, cards, buttons, or any future component — no
// component-specific code needed here.
function applyChildOverrides(instance, overrides) {
  if (!instance || !Array.isArray(overrides)) return
  for (const override of overrides) {
    try {
      const allChildInstances = instance.findAll(function(n) { return n.type === "INSTANCE" })
      var _overrideNeedle = normalizeName(override.childName)
      const allMatches = allChildInstances.filter(function(n) {
        if (normalizeName(n.name) === _overrideNeedle) return true
        // Also match by mainComponent parent name (for component set instances)
        var mc = n.mainComponent
        if (mc && mc.parent && mc.parent.type === "COMPONENT_SET") {
          return normalizeName(mc.parent.name) === _overrideNeedle
        }
        if (mc) return normalizeName(mc.name) === _overrideNeedle
        return false
      })
      const childInst = override.index !== undefined ? allMatches[override.index] : allMatches[0]
      if (childInst) {
        if (override.property === "$hover") {
          applyHoverToInstance(childInst)
        } else if (override.property === "visible") {
          childInst.visible = !!override.value
        } else {
          applyNamedVariants(childInst, { [override.property]: override.value })
        }
      }
    } catch (e) {
      console.warn("[childOverrides] error:", e.message)
    }
  }
}

// ─── Variant State ───────────────────────────────────────────────────────────
// Validates variant value against allowed options before calling setProperties.
// Uses exact-match (includes) — never guesses or coerces case.
function applyVariantState(instance, meta) {
  if (!meta || !meta.variantState) return

  const props = instance.componentProperties
  if (!props) return

  for (const key in props) {
    const prop = props[key]

    if (prop.type !== "VARIANT") continue

    const allowedValues = prop.variantOptions || []

    // When variantOptions is populated, validate before applying.
    // When it's empty (Figma doesn't populate it on instances), attempt and catch.
    if (allowedValues.length > 0 && !allowedValues.includes(meta.variantState)) {
      console.warn("Invalid variant value:", meta.variantState, "Allowed:", allowedValues)
      continue
    }

    try {
      instance.setProperties({ [key]: meta.variantState })
    } catch (err) {
      console.warn("Variant apply failed:", key, meta.variantState)
    }
  }
}

// ─── Instance Property Overrides ─────────────────────────────────────────────
// Applies text, icon, and enabled overrides via component properties.
// Variant state is intentionally excluded here — handled by applyVariantState.
async function applyInstanceOverrides(instance, data, componentMap) {
  if (!instance || !instance.componentProperties) return

  const props = instance.componentProperties
  const meta = data.meta || {}

  const replaceLabelText = meta["replace.labelText"] != null ? meta["replace.labelText"] : null
  const replaceInputValue = meta["replace.inputValue"] != null ? meta["replace.inputValue"] : null
  const replaceCTAText = meta["replace.CTAText"] != null ? meta["replace.CTAText"] : null
  const replaceHeaderText = meta["replace.HeaderText"] != null ? meta["replace.HeaderText"] : null
  const replaceHeaderDescription = meta["replace.HeaderDescription"] != null ? meta["replace.HeaderDescription"] : null
  const labelText = replaceLabelText !== null
    ? replaceLabelText
    : (meta.label != null ? meta.label : data.label)
  const iconValue = meta.icon != null ? meta.icon : data.icon
  const valueText = meta.value != null ? meta.value : data.value
  const placeholderText = replaceInputValue !== null
    ? replaceInputValue
    : (meta.placeholder != null ? meta.placeholder : data.placeholder)
  const enabledValue = meta.enabled != null ? meta.enabled : data.enabled

  let didSetIcon = false
  let didSetValue = false
  let didSetPlaceholder = false

  if (iconValue) {
    const target = await resolveComponentForSwap(iconValue, componentMap)
    if (target) {
      for (const [key, prop] of Object.entries(props)) {
        const propName = normalizePropName(prop && prop.name)
        if (prop && prop.type === "INSTANCE_SWAP" && propName.includes("icon")) {
          try {
            instance.setProperties({ [key]: target })
            didSetIcon = true
          } catch (err) {
            console.warn("Property override skipped:", key, iconValue)
          }
        }
      }
    }
  }

  if (replaceCTAText !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.ctatext")) {
        try {
          instance.setProperties({ [key]: String(replaceCTAText) })
        } catch (err) {
          console.warn("Property override skipped:", key, replaceCTAText)
        }
      }
    }
  }

  if (replaceHeaderText !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.headertext")) {
        try {
          instance.setProperties({ [key]: String(replaceHeaderText) })
        } catch (err) {
          console.warn("Property override skipped:", key, replaceHeaderText)
        }
      }
    }
  }

  if (replaceHeaderDescription !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.headerdescription")) {
        try {
          instance.setProperties({ [key]: String(replaceHeaderDescription) })
        } catch (err) {
          console.warn("Property override skipped:", key, replaceHeaderDescription)
        }
      }
    }
  }

  if (replaceLabelText !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.labeltext")) {
        try {
          instance.setProperties({ [key]: String(replaceLabelText) })
        } catch (err) {
          console.warn("Property override skipped:", key, replaceLabelText)
        }
      }
    }
  }

  if (replaceInputValue !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.inputvalue")) {
        try {
          instance.setProperties({ [key]: String(replaceInputValue) })
          didSetValue = true
        } catch (err) {
          console.warn("Property override skipped:", key, replaceInputValue)
        }
      }
    }
  }

  if (labelText != null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("label")) {
        try {
          instance.setProperties({ [key]: String(labelText) })
        } catch (err) {
          console.warn("Property override skipped:", key, labelText)
        }
      }
    }
  }

  if (valueText != null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && (propName.includes("value") || propName.includes("text"))) {
        try {
          instance.setProperties({ [key]: String(valueText) })
          didSetValue = true
        } catch (err) {
          console.warn("Property override skipped:", key, valueText)
        }
      }
    }
  }

  if (placeholderText != null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && (propName.includes("placeholder") || propName.includes("hint"))) {
        try {
          instance.setProperties({ [key]: String(placeholderText) })
          didSetPlaceholder = true
        } catch (err) {
          console.warn("Property override skipped:", key, placeholderText)
        }
      }
    }
  }

  if (typeof enabledValue === "boolean") {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "BOOLEAN" && (propName.includes("enabled") || propName.includes("disabled"))) {
        const nextValue = propName.includes("disabled") ? !enabledValue : enabledValue
        try {
          instance.setProperties({ [key]: nextValue })
        } catch (err) {
          console.warn("Property override skipped:", key, nextValue)
        }
      }
    }
  }

  if (iconValue && !didSetIcon) {
    const target = await resolveComponentForSwap(iconValue, componentMap)
    if (target) {
      for (const [key, prop] of Object.entries(props)) {
        if (prop && prop.type === "INSTANCE_SWAP") {
          try {
            instance.setProperties({ [key]: target })
            didSetIcon = true
            break
          } catch (err) {
            console.warn("Property override skipped:", key, iconValue)
          }
        }
      }
    }
  }

  if (placeholderText != null && !didSetPlaceholder) {
    const placeholderLower = String(placeholderText).toLowerCase()
    for (const [key, prop] of Object.entries(props)) {
      if (prop && prop.type === "TEXT") {
        const current = String(prop.value || "").toLowerCase()
        if (current.includes("placeholder") || current === "" || current === placeholderLower) {
          try {
            instance.setProperties({ [key]: String(placeholderText) })
            didSetPlaceholder = true
            break
          } catch (err) {
            console.warn("Property override skipped:", key, placeholderText)
          }
        }
      }
    }
  }

  if (valueText != null && !didSetValue) {
    for (const [key, prop] of Object.entries(props)) {
      if (prop && prop.type === "TEXT") {
        const current = String(prop.value || "")
        if (!current || current === "—") {
          try {
            instance.setProperties({ [key]: String(valueText) })
            didSetValue = true
            break
          } catch (err) {
            console.warn("Property override skipped:", key, valueText)
          }
        }
      }
    }
  }
}


function isSlotName(name) {
  return String(name || "").startsWith("slot.")
}

function getChildIndex(child, fallback) {
  const index = child && child.meta && child.meta.index
  return Number.isFinite(index) ? index : fallback
}

function getNodePosition(node) {
  if (node && node.absoluteBoundingBox) {
    return { x: node.absoluteBoundingBox.x, y: node.absoluteBoundingBox.y }
  }
  return { x: node.x || 0, y: node.y || 0 }
}

function swapInstanceWithCorrectSize(instance, swapTarget) {
  instance.swapComponent(swapTarget)
  // Mirror the master component's own sizing mode.
  // If the master uses HUG (e.g. textarea grows with content), preserve that.
  // Only force FIXED + resize when the master itself is FIXED.
  const sizeRef = (swapTarget.parent && swapTarget.parent.type === "COMPONENT_SET")
    ? swapTarget.parent.defaultVariant
    : swapTarget
  const hSizing = ("layoutSizingHorizontal" in sizeRef)
    ? sizeRef.layoutSizingHorizontal
    : "FIXED"
  const vSizing = ("layoutSizingVertical" in sizeRef)
    ? sizeRef.layoutSizingVertical
    : "FIXED"
  if ("layoutSizingHorizontal" in instance) {
    instance.layoutSizingHorizontal = hSizing
  }
  if ("layoutSizingVertical" in instance) {
    instance.layoutSizingVertical = vSizing
  }
  if (hSizing === "FIXED" || vSizing === "FIXED") {
    instance.resizeWithoutConstraints(
      hSizing === "FIXED" ? sizeRef.width : instance.width,
      vSizing === "FIXED" ? sizeRef.height : instance.height
    )
  }
}

function sortByPosition(nodes) {
  return nodes.slice().sort((a, b) => {
    const pa = getNodePosition(a)
    const pb = getNodePosition(b)
    if (pa.y !== pb.y) return pa.y - pb.y
    return pa.x - pb.x
  })
}

async function applySlotChildren(slotInstance, children, componentMap) {
  let container = slotInstance
  const isExcludedInstance = (_node, combined) => {
    if (!combined) return false
    if (combined.indexOf("icon/") !== -1) return true
    if (combined.indexOf("hint") !== -1) return true
    return false
  }
  const directTargets = container.children.filter(n => {
    if (n.type !== "INSTANCE") return false
    const name = normalizeName(n.name || "")
    if (isExcludedInstance(n, name)) return false
    return true
  })
  let targets = sortByPosition(directTargets)
  const orderedChildren = (children || [])
    .slice()
    .sort((a, b) => {
      const aIndex = getChildIndex(a, Number.MAX_SAFE_INTEGER)
      const bIndex = getChildIndex(b, Number.MAX_SAFE_INTEGER)
      return aIndex - bIndex
    })

  const deepTargets = container.findAll(n => {
    if (n.type !== "INSTANCE") return false
    const name = normalizeName(n.name || "")
    const mainName = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
    const combined = name + " " + mainName
    if (isExcludedInstance(n, combined)) return false
    return combined.indexOf("comp.input.") !== -1
  })

  if (deepTargets.length) {
    targets = sortByPosition(deepTargets)
  } else {
    targets = sortByPosition(directTargets)
  }

  // Debug: slot mapping visibility (remove after confirming)
  try {
    const slotName = String(container.name || "")
    const targetNames = targets.map(t => {
      const mainName = t.mainComponent ? t.mainComponent.name : ""
      return `${t.name}${mainName ? " -> " + mainName : ""}`
    })
    console.warn(
      "applySlotChildren",
      slotName,
      "children:",
      (children || []).length,
      "targets:",
      targets.length,
      targetNames
    )
  } catch (err) {
    console.warn("applySlotChildren debug failed", err)
  }

  const remainingTargets = targets.slice()

  // State for card.dashboard slot instructions (role: "card")
  let _cardSlotRef = null
  let _cardSlotParent = null

  // State for table.item slot instructions (role: "table-item")
  let _tableItemRef = null
  let _tableItemParent = null
  let _replPositionMap = null  // replacement-key → TEXT-node index in template (built once at i=0)

  for (let i = 0; i < orderedChildren.length; i++) {
    const child = orderedChildren[i]
    if (!child) continue

    if (child.type === "SLOT_INSTRUCTION") {
      const role = child.role || ""

      // ── card.dashboard generation ─────────────────────────────────────────
      if (role === "card") {
        if (i === 0) {
          // Find and cache card.dashboard reference on first card instruction
          _cardSlotRef = null
          _cardSlotParent = null
          const allCards = container.findAll(n => {
            if (n.type !== "INSTANCE") return false
            const setName = n.mainComponent && n.mainComponent.parent
              ? normalizeName(n.mainComponent.parent.name) : ""
            const compName = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
            const nodeName = normalizeName(n.name || "")
            return setName === "card.dashboard" || compName === "card.dashboard" || nodeName === "card.dashboard"
          })
          if (allCards.length > 0) {
            _cardSlotRef = allCards[0]
            _cardSlotParent = allCards[0].parent
            // Remove all existing card instances from remainingTargets so they aren't hidden
            for (const c of allCards) {
              const ri = remainingTargets.indexOf(c)
              if (ri !== -1) remainingTargets.splice(ri, 1)
            }
            // Convert GRID → HORIZONTAL+WRAP so appended clones auto-flow like a grid
            if (_cardSlotParent) {
              try {
                const lm = _cardSlotParent.layoutMode
                if (lm === "GRID" || lm === "NONE") {
                  const colGap = _cardSlotParent.itemSpacing || 25
                  const rowGap = _cardSlotParent.counterAxisSpacing || _cardSlotParent.itemSpacing || 25
                  _cardSlotParent.layoutMode = "HORIZONTAL"
                  _cardSlotParent.layoutWrap = "WRAP"
                  _cardSlotParent.itemSpacing = colGap
                  _cardSlotParent.counterAxisSpacing = rowGap
                }
              } catch (_) {}
            }
          }
        }

        if (!_cardSlotRef) {
          console.warn("card.dashboard ref not found at i=", i)
          continue
        }

        // Helper: is this instance a card.dashboard?
        const isCardInstance = n => {
          if (!n || n.type !== "INSTANCE") return false
          const setName = n.mainComponent && n.mainComponent.parent
            ? normalizeName(n.mainComponent.parent.name) : ""
          const compName = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
          const nodeName = normalizeName(n.name || "")
          return setName === "card.dashboard" || compName === "card.dashboard" || nodeName === "card.dashboard"
        }

        // Get current cards in the parent (refreshed each iteration to pick up clones)
        const existingCards = _cardSlotParent
          ? Array.from(_cardSlotParent.children).filter(isCardInstance)
          : []

        let cardInstance = (i < existingCards.length) ? existingCards[i] : null
        if (!cardInstance) {
          let created = null
          // Always create fresh from defaultVariant to avoid inheriting mutated state
          try {
            const mc = _cardSlotRef.mainComponent
            const base = (mc && mc.parent && mc.parent.type === "COMPONENT_SET")
              ? mc.parent.defaultVariant : mc
            if (base) {
              created = base.createInstance()
              ;(_cardSlotParent || container).appendChild(created)
            }
          } catch (createErr) {
            // Fallback: clone
            try {
              created = _cardSlotRef.clone()
              ;(_cardSlotParent || container).appendChild(created)
            } catch (cloneErr) {
              console.warn("card.dashboard create/clone failed at i=" + i + ":", String(cloneErr))
            }
          }
          cardInstance = created
          if (!cardInstance) continue
        }

        cardInstance.visible = true

        // Ensure card flows into the GRID layout (not absolutely positioned)
        try { cardInstance.layoutPositioning = "AUTO" } catch (_) {}

        // Apply Card State variant — reset to default first if no cardState
        if (child.cardState) {
          try { applyVariantState(cardInstance, { variantState: child.cardState }) } catch (_) {}
        } else {
          try {
            const mc = cardInstance.mainComponent
            if (mc && mc.parent && mc.parent.type === "COMPONENT_SET") {
              cardInstance.swapComponent(mc.parent.defaultVariant)
            }
          } catch (_) {}
        }

        // Apply Text Length variant (Ellipsis for names > 25 chars, Default otherwise)
        try {
          const appNameInst = cardInstance.findOne(n => {
            if (n.type !== "INSTANCE") return false
            const mn = normalizeName(n.mainComponent ? n.mainComponent.name : "")
            const nn = normalizeName(n.name || "")
            return mn === "replace.appname" || nn === "replace.appname"
          })
          if (appNameInst) {
            applyNamedVariants(appNameInst, { "Text Length": child.textLength || "Default" })
          } else {
            applyNamedVariants(cardInstance, { "Text Length": child.textLength || "Default" })
          }
        } catch (_) {}

        // Override replace.Appname text
        if (child.appName) {
          const appNode = cardInstance.findOne(n => n.type === "TEXT" && normalizeName(n.name) === "replace.appname")
          if (appNode) {
            try { await figma.loadFontAsync(appNode.fontName); appNode.characters = child.appName } catch (_) {}
          }
        }

        // Override replace.Createdon text
        if (child.createdOn) {
          const dateNode = cardInstance.findOne(n => n.type === "TEXT" && normalizeName(n.name) === "replace.createdon")
          if (dateNode) {
            try { await figma.loadFontAsync(dateNode.fontName); dateNode.characters = "Created on " + child.createdOn } catch (_) {}
          }
        }

        // Apply appicon.avatar properties
        if (child.avatarConfig) {
          const cfg = child.avatarConfig
          const avatarNode = cardInstance.findOne(n => {
            if (n.type !== "INSTANCE") return false
            const mn = normalizeName(n.mainComponent ? (n.mainComponent.parent ? n.mainComponent.parent.name : n.mainComponent.name) : "")
            const nn = normalizeName(n.name || "")
            return mn === "appicon.avatar" || nn === "appicon.avatar"
          })
          if (avatarNode) {
            applyNamedVariants(avatarNode, {
              "Avatar Type": cfg.type,
              "Border Radius": cfg.borderRadius || "Default",
              "Status Hint": cfg.statusHint
            })
            if (cfg.type === "Solid" && cfg.color) {
              const appiconNode = avatarNode.findOne(n => {
                if (n.type !== "INSTANCE") return false
                const mn = normalizeName(n.mainComponent ? (n.mainComponent.parent ? n.mainComponent.parent.name : n.mainComponent.name) : "")
                const nn = normalizeName(n.name || "")
                return mn === "appicon" || nn === "appicon"
              })
              if (appiconNode) {
                applyNamedVariants(appiconNode, { "Color": cfg.color, "Inverse": false })
                // Set initials text inside appicon
                if (child.appIcon) {
                  const iconTextNode = appiconNode.findOne(n => n.type === "TEXT" && normalizeName(n.name) === "replace.appicon")
                  if (iconTextNode) {
                    try { await figma.loadFontAsync(iconTextNode.fontName); iconTextNode.characters = child.appIcon } catch (_) {}
                  }
                }
              }
            } else if (cfg.type === "Image" && cfg.userVariant) {
              const userNode = avatarNode.findOne(n => {
                if (n.type !== "INSTANCE") return false
                const mn = normalizeName(n.mainComponent ? (n.mainComponent.parent ? n.mainComponent.parent.name : n.mainComponent.name) : "")
                const nn = normalizeName(n.name || "")
                return mn === "user" || nn === "user"
              })
              if (userNode) {
                applyNamedVariants(userNode, { "User": cfg.userVariant })
              }
            }
          }
        }

        // Apply childOverrides — generic helper, works for any component
        applyChildOverrides(cardInstance, child.childOverrides)

        continue
      }

      // ── table.item generation ─────────────────────────────────────────────
      if (role === "table-item") {
        if (i === 0) {
          _tableItemRef = null
          _tableItemParent = null
          // Detach container if INSTANCE — Figma blocks appendChild on instances,
          // so detaching converts it to a FRAME, allowing new rows to be appended.
          if (container.type === "INSTANCE") {
            try { var _detached = container.detachInstance(); if (_detached) container = _detached } catch (_) {}
          }
          const allTableItems = container.findAll(function(n) {
            const nodeName = normalizeName(n.name || "")
            if (nodeName === "table.item" || nodeName === "sub.table.item" || nodeName === "sub.table") return true
            if (n.type === "INSTANCE") {
              const setName = n.mainComponent && n.mainComponent.parent
                ? normalizeName(n.mainComponent.parent.name) : ""
              const compName = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
              return setName === "table.item" || compName === "table.item"
            }
            return false
          })
          // Fallback for subtable: row template is a plain FRAME (e.g. "Frame 1000006657")
          // that contains text.username but isn't named "table.item"
          if (allTableItems.length === 0 && normalizeName(container.name || "").indexOf("subtable") !== -1) {
            var _kids = Array.from(container.children)
            for (var _ki2 = 0; _ki2 < _kids.length; _ki2++) {
              var _kid = _kids[_ki2]
              if (!_kid.findOne) continue
              var _hasRow = _kid.findOne(function(n) {
                var _cn = normalizeName(n.name || "")
                return _cn === "replace.username" || _cn === "text.username" || _cn === "replace.name" || _cn === "text.name"
              })
              if (_hasRow) { allTableItems.push(_kid); break }
            }
          }
          // Broader fallback: any container with a child having a "replace." text node
          if (allTableItems.length === 0) {
            var _kids2 = Array.from(container.children)
            for (var _ki3 = 0; _ki3 < _kids2.length; _ki3++) {
              var _kid2 = _kids2[_ki3]
              if (!_kid2.findOne) continue
              var _hasReplace = _kid2.findOne(function(n) {
                var _cn2 = normalizeName(n.name || "")
                return _cn2.indexOf("replace.") === 0 || _cn2.indexOf("text.") === 0
              })
              if (_hasReplace) { allTableItems.push(_kid2); break }
            }
          }

          if (allTableItems.length > 0) {
            _tableItemRef = allTableItems[0]
            _tableItemParent = allTableItems[0].parent
            for (let _ti = 0; _ti < allTableItems.length; _ti++) {
              const _riIdx = remainingTargets.indexOf(allTableItems[_ti])
              if (_riIdx !== -1) remainingTargets.splice(_riIdx, 1)
            }
            if (_tableItemParent) {
              try {
                const lm = _tableItemParent.layoutMode
                // Keep GRID only when template already has multiple rows (e.g. slot.content.table
                // designed with 10 pre-existing slots). Single-template containers (1 row) must
                // be converted to VERTICAL so cloned rows stack instead of overflowing the grid.
                const _gridHasMultipleTemplates = allTableItems.length > 1
                if (!lm || lm === "NONE" || (lm === "GRID" && !_gridHasMultipleTemplates)) {
                  _tableItemParent.layoutMode = "VERTICAL"
                  _tableItemParent.itemSpacing = 0
                }
                // After detach/layout setup, re-apply AUTO positioning to all existing
                // rows so they flow in the grid instead of sitting at absolute coords
                var _pKids = Array.from(_tableItemParent.children || [])
                for (var _pki = 0; _pki < _pKids.length; _pki++) {
                  try { _pKids[_pki].layoutPositioning = "AUTO" } catch (_) {}
                }
              } catch (_) {}
            }
          }
        }

        if (!_tableItemRef) {
          console.warn("table.item ref not found at i=", i)
          continue
        }

        const isTableItemInstance = function(n) {
          if (!n) return false
          const nodeName = normalizeName(n.name || "")
          if (nodeName === "table.item" || nodeName === "sub.table.item" || nodeName === "sub.table") return true
          if (n.type === "INSTANCE") {
            const setName = n.mainComponent && n.mainComponent.parent
              ? normalizeName(n.mainComponent.parent.name) : ""
            const compName = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
            return setName === "table.item" || compName === "table.item"
          }
          // Also match nodes that are the same reference as _tableItemRef (fallback template)
          if (_tableItemRef && n.id && _tableItemRef.id && n.id === _tableItemRef.id) return true
          return false
        }

        const existingTableItems = _tableItemParent
          ? Array.from(_tableItemParent.children).filter(isTableItemInstance)
          : []

        let tableItemInstance = (i < existingTableItems.length) ? existingTableItems[i] : null
        if (!tableItemInstance) {
          let createdRow = null
          try {
            createdRow = _tableItemRef.clone()
            ;(_tableItemParent || container).appendChild(createdRow)
          } catch (_cloneErr) {
            try {
              const mc = _tableItemRef.mainComponent
              const base = (mc && mc.parent && mc.parent.type === "COMPONENT_SET")
                ? mc.parent.defaultVariant : mc
              if (base) {
                createdRow = base.createInstance()
                ;(_tableItemParent || container).appendChild(createdRow)
              }
            } catch (_createErr) {
              console.warn("table.item create/clone failed at i=" + i)
            }
          }
          tableItemInstance = createdRow
          if (!tableItemInstance) continue
        }

        tableItemInstance.visible = true
        try { tableItemInstance.layoutPositioning = "AUTO" } catch (_) {}


        // Apply status.text variant (Active / Inactive)
        if (child.status) {
          var _statusNode = tableItemInstance.findOne(function(n) {
            if (n.type !== "INSTANCE") return false
            var _nn = normalizeName(n.name || "")
            if (_nn === "status.text") return true
            var _mc = n.mainComponent
            if (_mc) {
              var _mn = normalizeName(_mc.parent ? _mc.parent.name : _mc.name)
              if (_mn === "status.text") return true
            }
            return false
          })
          if (_statusNode) {
            try { applyNamedVariants(_statusNode, { "State": child.status }) } catch (_) {}
          }
        }

        // Apply State variant on the row itself (Hover / Default)
        try { applyNamedVariants(tableItemInstance, { "State": child.rowHover ? "Hover" : "Default" }) } catch (_) {}

        // Apply row hover effects — only for the hovered row
        var _ellNode2 = tableItemInstance.findOne(function(n) {
          if (n.type !== "INSTANCE") return false
          return normalizeName(n.name || "") === "table.more.ellipsis"
        })
        if (child.rowHover) {
          // Set "Group 1" fill to "Semantic/Secondary/Surface/secondary-surface-subtle-hover".
          // Strategy: find the variable by scanning all bound fills on the current page,
          // then bind it directly. Falls back to copying fills from the Hover variant.
          var _bgNode = tableItemInstance.findOne(function(n) {
            return normalizeName(n.name || "") === "group 1"
          })
          if (_bgNode) {
            try {
              var _targetVarName = "Semantic/Secondary/Surface/secondary-surface-subtle-hover"
              var _foundVar = null
              // 1. Check local variables first (fast path)
              var _localVars = figma.variables.getLocalVariables()
              for (var _lvi = 0; _lvi < _localVars.length; _lvi++) {
                if (_localVars[_lvi].name === _targetVarName) {
                  _foundVar = _localVars[_lvi]; break
                }
              }
              // 2. If not local, scan page nodes for any fill that has this variable bound
              if (!_foundVar) {
                var _scanNodes = figma.currentPage.findAll(function(n) {
                  return n.fills && Array.isArray(n.fills) && n.fills.length > 0
                })
                outer: for (var _sni = 0; _sni < _scanNodes.length; _sni++) {
                  var _snFills = _scanNodes[_sni].fills
                  for (var _sfi = 0; _sfi < _snFills.length; _sfi++) {
                    var _sfBv = _snFills[_sfi].boundVariables
                    if (_sfBv && _sfBv.color && _sfBv.color.id) {
                      var _v = figma.variables.getVariableById(_sfBv.color.id)
                      if (_v && _v.name === _targetVarName) {
                        _foundVar = _v; break outer
                      }
                    }
                  }
                }
              }
              if (_foundVar) {
                var _paint = { type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }
                _bgNode.fills = [figma.variables.setBoundVariableForPaint(_paint, "color", _foundVar)]
              } else {
                // Fallback: copy fills from the Hover variant of the component master
                var _mc = tableItemInstance.mainComponent
                var _cs = _mc ? _mc.parent : null
                if (_cs && _cs.type === "COMPONENT_SET") {
                  for (var _cvi = 0; _cvi < _cs.children.length; _cvi++) {
                    var _cvc = _cs.children[_cvi]
                    var _cvn = normalizeName(_cvc.name || "")
                    if (_cvn.indexOf("hover") !== -1 && _cvn.indexOf("card") === -1) {
                      var _hoverBg = _cvc.findOne(function(n) {
                        return normalizeName(n.name || "") === "group 1"
                      })
                      if (_hoverBg && _hoverBg.fills && _hoverBg.fills.length > 0) {
                        _bgNode.fills = _hoverBg.fills; break
                      }
                    }
                  }
                }
              }
            } catch (_bgErr) {}
          }
          // First row only: set table.more.ellipsis to hover state
          if (_ellNode2) {
            try { applyNamedVariants(_ellNode2, { "state": "card-hover" }) } catch (_) {}
            try { applyNamedVariants(_ellNode2, { "Ellipsis": "card-hover" }) } catch (_) {}
          }
        } else {
          // All other rows: ensure table.more.ellipsis stays Default
          if (_ellNode2) {
            try { applyNamedVariants(_ellNode2, { "State": "Default" }) } catch (_) {}
            try { applyNamedVariants(_ellNode2, { "Ellipsis": "Default" }) } catch (_) {}
          }
        }

        // Replace placeholder text nodes
        if (child.replacements) {
          // Build position map once from the unmodified template (i=0) so that
          // cloned rows (i≥1) can fall back to index-based lookup even when
          // node names differ from the replacement key or the template text was
          // already overwritten by a previous row's replacement.
          if (_replPositionMap === null && _tableItemRef) {
            _replPositionMap = {}
            var _tmplTexts = _tableItemRef.findAll(function(n) { return n.type === "TEXT" })
            var _mapKeys = Object.keys(child.replacements)
            for (var _mpki = 0; _mpki < _mapKeys.length; _mpki++) {
              var _mpk = _mapKeys[_mpki]
              var _mpkNorm = normalizeName(_mpk)
              for (var _mpni = 0; _mpni < _tmplTexts.length; _mpni++) {
                if (normalizeName(_tmplTexts[_mpni].name || "") === _mpkNorm) {
                  _replPositionMap[_mpk] = _mpni; break
                }
              }
              if (_replPositionMap[_mpk] === undefined) {
                for (var _mpni2 = 0; _mpni2 < _tmplTexts.length; _mpni2++) {
                  if (normalizeName(_tmplTexts[_mpni2].characters || "") === _mpkNorm) {
                    _replPositionMap[_mpk] = _mpni2; break
                  }
                }
              }
            }
          }

          const replKeys = Object.keys(child.replacements)
          for (let _ki = 0; _ki < replKeys.length; _ki++) {
            const _k = replKeys[_ki]
            const _v = child.replacements[_k]
            if (!_v) continue
            const _norm = normalizeName(_k)
            var _textNode = tableItemInstance.findOne(function(n) {
              return n.type === "TEXT" && normalizeName(n.name) === _norm
            })
            // Fallback 1: search by placeholder text content (works on unmodified template)
            if (!_textNode) {
              _textNode = tableItemInstance.findOne(function(n) {
                return n.type === "TEXT" && normalizeName(n.characters || "") === _norm
              })
            }
            // Fallback 2: positional — use the index recorded from the template at i=0
            if (!_textNode && _replPositionMap !== null && _replPositionMap[_k] !== undefined) {
              var _rowAllTexts = tableItemInstance.findAll(function(n) { return n.type === "TEXT" })
              _textNode = _rowAllTexts[_replPositionMap[_k]] || null
            }
            if (_textNode) {
              try {
                await figma.loadFontAsync(_textNode.fontName)
                _textNode.characters = _v
              } catch (_fontErr) {
                try {
                  await figma.loadFontAsync({ family: "Inter", style: "Regular" })
                  _textNode.characters = _v
                } catch (_) {}
              }
            }
          }
        }

        // Replace lastactive text — node named by its content, found via text.lastactive container
        if (child.lastactive) {
          var _laContainer = tableItemInstance.findOne(function(n) {
            return normalizeName(n.name || "") === "text.lastactive"
          })
          if (_laContainer) {
            var _laText = _laContainer.findOne(function(n) { return n.type === "TEXT" })
            if (_laText) {
              try {
                await figma.loadFontAsync(_laText.fontName)
                _laText.characters = child.lastactive
              } catch (_laErr) {
                try {
                  await figma.loadFontAsync({ family: "Inter", style: "Regular" })
                  _laText.characters = child.lastactive
                } catch (_) {}
              }
            }
          }
        }

        // Apply childOverrides on this row (e.g. set input.check to checked on row 0)
        if (Array.isArray(child.childOverrides) && child.childOverrides.length) {
          applyChildOverrides(tableItemInstance, child.childOverrides)
        }

        continue
      }

      // ── stepper generation (wizard nav) ──────────────────────────────────
      if (role === "stepper") {
        // Find wizard.item (GROUP/FRAME) — the cloneable unit containing stepper.radio.item + label
        var wizardItemRef = container.findOne(function(n) {
          return (n.type === "GROUP" || n.type === "FRAME") && normalizeName(n.name || "") === "wizard.item"
        })

        if (wizardItemRef) {
          var wizardItemParent = wizardItemRef.parent || container

          // Determine the target: reuse first, clone for rest
          var targetItem = null
          if (i === 0) {
            targetItem = wizardItemRef
          } else {
            try {
              targetItem = wizardItemRef.clone()
              wizardItemParent.appendChild(targetItem)
              try { targetItem.layoutPositioning = "AUTO" } catch (_) {}
            } catch (cloneErr) {
              console.warn("wizard.item clone failed at i=" + i, String(cloneErr))
            }
          }

          if (targetItem) {
            // Find stepper.radio.item INSTANCE inside wizard.item and apply state
            var stepperInst = targetItem.findOne(function(n) {
              if (n.type !== "INSTANCE") return false
              var mc = n.mainComponent
              if (mc && mc.parent && mc.parent.type === "COMPONENT_SET") {
                return normalizeName(mc.parent.name) === "stepper.radio.item"
              }
              return normalizeName(n.name || "") === "stepper.radio.item"
            })
            if (stepperInst) {
              try { applyVariantState(stepperInst, { variantState: child.stepState || "default" }) } catch (_) {}
            }

            // Find TEXT node inside wizard.item and set label
            var labelNode = targetItem.findOne(function(n) { return n.type === "TEXT" })
            if (labelNode && child.label) {
              try { await figma.loadFontAsync(labelNode.fontName); labelNode.characters = child.label } catch (_) {}
            }

            // Hide stepper.gapstrip on the last wizard item
            var isLastStepper = true
            for (var _si = i + 1; _si < orderedChildren.length; _si++) {
              if (orderedChildren[_si] && orderedChildren[_si].role === "stepper") { isLastStepper = false; break }
            }
            if (isLastStepper) {
              var gapstrip = targetItem.findOne(function(n) { return normalizeName(n.name || "") === "stepper.gapstrip" })
              if (gapstrip) gapstrip.visible = false
            }
          }
        } else {
          console.warn("wizard.item not found in container:", container.name)
        }
        continue
      }

      // ── tableColumn / default SLOT_INSTRUCTION ────────────────────────────
      const pos = i < targets.length ? i : -1
      if (pos >= 0) {
        const existingTarget = targets[pos]
        const idx = remainingTargets.indexOf(existingTarget)
        if (idx !== -1) remainingTargets.splice(idx, 1)
        existingTarget.visible = true
        const itemState = child.cardState || child.rowState || null
        if (itemState && existingTarget.type === "INSTANCE") {
          try {
            applyVariantState(existingTarget, { variantState: itemState })
          } catch (_) {}
        }
      }
      continue
    }

    const childMeta = child.meta || {}
    const index = getChildIndex(child, -1)
    const childComponent =
      (childMeta.componentName !== undefined && childMeta.componentName !== null)
        ? childMeta.componentName
        : (child.componentName !== undefined && child.componentName !== null)
          ? child.componentName
          : child.name

    let target = null
    if (childComponent) {
      const needle = normalizeName(childComponent)
      const matchIndex = remainingTargets.findIndex(t => {
        const mainName = t.mainComponent ? normalizeName(t.mainComponent.name) : ""
        const name = normalizeName(t.name || "")
        return mainName === needle || name === needle
      })
      if (matchIndex !== -1) {
        target = remainingTargets.splice(matchIndex, 1)[0]
      }
      // If not in remainingTargets (already consumed by a SLOT_INSTRUCTION pos match),
      // fall back to searching all targets by name so named children (e.g. slot.content.details.subtable)
      // are never silently skipped when tableColumn SLOT_INSTRUCTIONs consumed targets[0..n].
      // Skip this fallback for comp.input.* — reusing a consumed input instance would overwrite
      // an earlier field's data with a later field's (e.g. Furniture Type overwritten by Furniture Condition).
      var _needleIsInput = needle.indexOf("comp.input.") !== -1
      if (!target && !_needleIsInput) {
        for (var _tfi = 0; _tfi < targets.length; _tfi++) {
          var _tft = targets[_tfi]
          var _tfMain = _tft.mainComponent ? normalizeName(_tft.mainComponent.name) : ""
          var _tfName = normalizeName(_tft.name || "")
          if (_tfMain === needle || _tfName === needle) {
            target = _tft
            break
          }
        }
      }
      // Last resort: search the entire container subtree by name (covers cases where
      // targets was replaced by deepTargets and the named slot is not in targets at all).
      // Also skip for comp.input.* to avoid reuse.
      if (!target && !_needleIsInput) {
        var _containerSearch = container.findOne(function(n) {
          if (n.type !== "INSTANCE") return false
          var _csMain = n.mainComponent ? normalizeName(n.mainComponent.name) : ""
          var _csName = normalizeName(n.name || "")
          return _csMain === needle || _csName === needle
        })
        if (_containerSearch) target = _containerSearch
      }
    }

    if (!target) {
      const targetIndex = Number.isFinite(index) ? index : i
      if (targetIndex >= 0 && targetIndex < targets.length) {
        target = targets[targetIndex]
        const posIndex = remainingTargets.indexOf(target)
        if (posIndex !== -1) {
          remainingTargets.splice(posIndex, 1)
        }
      }
    }
    if (!target) {
      // Create a new instance when the slot doesn't have enough targets
      const component = childComponent
        ? await resolveComponentForData(childComponent, child, componentMap)
        : null
      if (component) {
        try {
          // Can't appendChild to an INSTANCE — detach it on-demand to convert to a FRAME
          if (container.type === "INSTANCE") {
            try { var _dcInst = container.detachInstance(); if (_dcInst) container = _dcInst } catch (_) {}
          }
          target = component.createInstance()
          container.appendChild(target)
          if (!container.layoutMode || container.layoutMode === "NONE") {
            const sorted = sortByPosition(targets)
            const last = sorted[sorted.length - 1]
            if (last && last.absoluteBoundingBox) {
              target.x = last.x
              target.y = last.y + last.height + 16
            }
          }
          targets.push(target)
        } catch (err) {
          target = null
        }
      }
    }
    if (!target) {
      // Frame-slot intercept: when the child is a slot-named node whose Figma counterpart is a
      // plain FRAME (not INSTANCE), target resolution above always returns null because every
      // search path has an INSTANCE-type guard. Catch that here — before the continue — by
      // finding the FRAME by name inside the container and recursively applying its children.
      // This handles the full all-FRAME chain:
      //   slot.content.details.table → slot.content.details.subtable → [10 rows]
      var _fsName = child.componentName || child.name || ""
      if (isSlotName(_fsName) && Array.isArray(child.children) && child.children.length > 0) {
        var _fsHasContent = false
        for (var _fsi = 0; _fsi < child.children.length; _fsi++) {
          var _fsChild = child.children[_fsi]
          if (!_fsChild) continue
          if (_fsChild.type === "SLOT_INSTRUCTION") { _fsHasContent = true; break }
          var _fsChildSlotName = _fsChild.componentName || _fsChild.name || ""
          if (isSlotName(_fsChildSlotName)) { _fsHasContent = true; break }
        }
        if (_fsHasContent) {
          var _fsNeedle = normalizeName(_fsName)
          var _fsFrame = container.findOne(function(n) {
            return normalizeName(n.name || "") === _fsNeedle
          })
          if (_fsFrame) {
            try {
              await applySlotChildren(_fsFrame, child.children, componentMap)
            } catch (_fsErr) {
              console.warn("applySlotChildren failed for frame-slot:", _fsName, String(_fsErr))
            }
          }
        }
      }
      continue
    }
    const childVisible = childMeta.visible !== undefined && childMeta.visible !== null
      ? childMeta.visible
      : child.visible
    if (childVisible === false) {
      target.visible = false
      continue
    }
    target.visible = true
    let didSwap = false
    if (childComponent) {
      const targetName = String(target.name || "")
      const childHasVariant = childMeta.variantState != null
      if (normalizeName(childComponent) !== normalizeName(targetName) || childHasVariant) {
        const swapTarget = await resolveComponentForData(childComponent, child, componentMap)
        if (swapTarget) {
          try {
            swapInstanceWithCorrectSize(target, swapTarget)
            didSwap = true
          } catch (err) {
            console.warn("swapComponent failed:", childComponent, err)
          }
        }
      }
    }
    try {
      // If variant was already set via swapComponent, strip variantState from meta
      // so applyVariantState doesn't double-apply and throw setProperties errors
      const childForMeta = (didSwap && childMeta.variantState != null)
        ? Object.assign({}, child, { meta: Object.assign({}, childMeta, { variantState: null }) })
        : child
      await applyMetaToInstance(target, childForMeta, componentMap)
    } catch (err) {
      console.warn("applyMetaToInstance failed for child:", child && child.name, err)
    }

    // If this child is a named slot with SLOT_INSTRUCTION children OR nested slot
    // children, process via applySlotChildren. This handles both:
    //   slot.content.details.subtable → direct SLOT_INSTRUCTIONs
    //   slot.content.details.table   → slot.content.details.subtable → SLOT_INSTRUCTIONs
    // Both table and subtable may be plain FRAMEs (not INSTANCEs) in Figma, so
    // normal INSTANCE-only target resolution misses them — we search by name below.
    var _nestedSlotName = child.componentName || child.name || ""
    if (isSlotName(_nestedSlotName) && Array.isArray(child.children) && child.children.length > 0) {
      var _hasSlotInstr = false
      for (var _nsi = 0; _nsi < child.children.length; _nsi++) {
        var _nsiChild = child.children[_nsi]
        if (!_nsiChild) continue
        if (_nsiChild.type === "SLOT_INSTRUCTION") { _hasSlotInstr = true; break }
        // Also trigger when children are nested slot nodes (e.g. slot.content.details.table
        // whose only child is slot.content.details.subtable which holds the rows)
        var _nsiChildName = _nsiChild.componentName || _nsiChild.name || ""
        if (isSlotName(_nsiChildName)) { _hasSlotInstr = true; break }
      }
      if (_hasSlotInstr) {
        // target may be null when the slot is a plain FRAME (not an INSTANCE) —
        // the normal target resolution only finds INSTANCE nodes. Fall back to
        // searching the container's descendants by name so FRAME-based slots
        // (e.g. slot.content.details.table, slot.content.details.subtable) are found.
        var _slotTarget = target
        if (!_slotTarget) {
          var _slotNeedle = normalizeName(_nestedSlotName)
          _slotTarget = container.findOne(function(n) {
            return normalizeName(n.name || "") === _slotNeedle
          })
        }
        if (_slotTarget) {
          try {
            await applySlotChildren(_slotTarget, child.children, componentMap)
          } catch (_nse) {
            console.warn("applySlotChildren failed for nested slot:", _nestedSlotName, String(_nse))
          }
        }
      }
    }
  }

  // Hide slot instances that have no corresponding JSON child
  for (const r of remainingTargets) {
    r.visible = false
  }

  // Re-stack fields for non-auto-layout parents only.
  // Auto-layout parents reflow naturally after resize() corrects the height.
  // Setting layoutPositioning=ABSOLUTE on all auto-layout children would remove them
  // from the auto-layout flow and cause the container to collapse.
  const visibleTargets = targets.filter(t => t.visible !== false)
  if (visibleTargets.length > 1) {
    const parentGroups = new Map()
    for (const t of visibleTargets) {
      const p = t.parent
      if (!p) continue
      if (!parentGroups.has(p)) parentGroups.set(p, [])
      parentGroups.get(p).push(t)
    }
    for (const [parentNode, group] of parentGroups) {
      if (group.length < 2) continue
      // Skip auto-layout parents — resize() already updated the child height,
      // and auto-layout recalculates positions automatically.
      if (parentNode.layoutMode && parentNode.layoutMode !== "NONE") continue
      const sorted = sortByPosition(group)
      const FIELD_GAP = 16
      let currentY = sorted[0].y
      for (const t of sorted) {
        try { t.y = currentY } catch (_) {}
        currentY += t.height + FIELD_GAP
      }
    }
  }
}

function findTextNode(instance, names) {
  return instance.findOne(n => n.type === "TEXT" && names.some(name => n.name.toLowerCase().includes(name)))
}

function findFirstTextNode(instance) {
  return instance.findOne(n => n.type === "TEXT")
}

function findChildInstanceByKey(instance, keyName) {
  const key = normalizeName(keyName)
  return instance.findOne(n => {
    if (n.type !== "INSTANCE") return false
    if (normalizeName(n.name) === key) return true
    if (n.mainComponent) {
      return normalizeName(n.mainComponent.name) === key
    }
    return false
  })
}

async function applyMetaToInstance(instance, data, componentMap) {
  const meta = data.meta || {}
  const visibleValue = meta.visible !== undefined && meta.visible !== null ? meta.visible : data.visible
  const enabledValue = meta.enabled !== undefined && meta.enabled !== null ? meta.enabled : data.enabled
  const replaceLabelText = meta["replace.labelText"] !== undefined && meta["replace.labelText"] !== null
    ? meta["replace.labelText"]
    : null
  const replaceInputValue = meta["replace.inputValue"] !== undefined && meta["replace.inputValue"] !== null
    ? meta["replace.inputValue"]
    : null
  const replaceCTAText = meta["replace.CTAText"] !== undefined && meta["replace.CTAText"] !== null
    ? meta["replace.CTAText"]
    : null
  const replaceHeaderText = meta["replace.HeaderText"] !== undefined && meta["replace.HeaderText"] !== null
    ? meta["replace.HeaderText"]
    : null
  const replaceHeaderDescription = meta["replace.HeaderDescription"] !== undefined && meta["replace.HeaderDescription"] !== null
    ? meta["replace.HeaderDescription"]
    : null
  const labelValue = replaceLabelText !== null
    ? replaceLabelText
    : (meta.label !== undefined && meta.label !== null ? meta.label : data.label)
  const valueValue = meta.value !== undefined && meta.value !== null
    ? meta.value
    : (data.value !== undefined && data.value !== null ? data.value : replaceInputValue)
  const placeholderValue = replaceInputValue !== null
    ? replaceInputValue
    : (meta.placeholder !== undefined && meta.placeholder !== null ? meta.placeholder : data.placeholder)
  const iconValue = meta.icon !== undefined && meta.icon !== null ? meta.icon : data.icon
  if (visibleValue === false) {
    instance.visible = false
  }
  if (enabledValue === false) {
    instance.opacity = 0.5
  }

  // 1. Apply variant state (validated exact-match, never throws)
  applyVariantState(instance, meta)

  // 2. Apply other component property overrides
  try {
    await applyInstanceOverrides(instance, data, componentMap)
  } catch (err) {
    console.warn("applyInstanceOverrides failed:", err)
  }

  // Fallbacks for text layers if component properties are not available
  let didSetLabel = false
  let didSetValue = false
  let didSetPlaceholder = false
  if (replaceCTAText !== null) {
    const ctaNodes = instance.findAll(n => n.type === "TEXT" && normalizeName(n.name).includes("replace.ctatext"))
    for (const node of ctaNodes) {
      await figma.loadFontAsync(node.fontName)
      node.characters = String(replaceCTAText)
    }
  }
  if (replaceHeaderText !== null) {
    const headerTextNodes = instance.findAll(n => n.type === "TEXT" && normalizeName(n.name).includes("replace.headertext"))
    for (const node of headerTextNodes) {
      await figma.loadFontAsync(node.fontName)
      node.characters = String(replaceHeaderText)
    }
  }
  if (replaceHeaderDescription !== null) {
    const headerDescNodes = instance.findAll(n => n.type === "TEXT" && normalizeName(n.name).includes("replace.headerdescription"))
    for (const node of headerDescNodes) {
      await figma.loadFontAsync(node.fontName)
      node.characters = String(replaceHeaderDescription)
    }
  }
  if (replaceLabelText !== null) {
    const labelNodes = instance.findAll(n => n.type === "TEXT" && normalizeName(n.name).includes("replace.labeltext"))
    for (const node of labelNodes) {
      await figma.loadFontAsync(node.fontName)
      node.characters = String(replaceLabelText)
      didSetLabel = true
    }
  }
  if (replaceInputValue !== null) {
    const valueNodes = instance.findAll(n => n.type === "TEXT" && normalizeName(n.name).includes("replace.inputvalue"))
    for (const node of valueNodes) {
      await figma.loadFontAsync(node.fontName)
      node.characters = String(replaceInputValue)
      didSetValue = true
      didSetPlaceholder = true
    }
  }
  if (!didSetLabel && labelValue !== undefined && labelValue !== null) {
    const labelNode = findTextNode(instance, ["label"])
    if (labelNode) {
      await figma.loadFontAsync(labelNode.fontName)
      labelNode.characters = String(labelValue)
      didSetLabel = true
    }
  }
  if (!didSetValue && valueValue !== undefined && valueValue !== null) {
    const valueNode = findTextNode(instance, ["value", "text", "input"])
    if (valueNode) {
      await figma.loadFontAsync(valueNode.fontName)
      valueNode.characters = String(valueValue)
      didSetValue = true
    }
  }
  if (!didSetPlaceholder && placeholderValue !== undefined && placeholderValue !== null) {
    let placeholderNode = findTextNode(instance, ["placeholder", "hint"])
    if (!placeholderNode) {
      placeholderNode = instance.findOne(n => n.type === "TEXT" && normalizeName(n.name) === "placeholder text")
    }
    if (placeholderNode) {
      await figma.loadFontAsync(placeholderNode.fontName)
      placeholderNode.characters = String(placeholderValue)
      didSetPlaceholder = true
    }
  }
  if (!didSetLabel && labelValue !== undefined && labelValue !== null) {
    const anyText = findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(labelValue)
      didSetLabel = true
    }
  }
  if (!didSetValue && valueValue !== undefined && valueValue !== null) {
    const anyText = findTextNode(instance, ["value", "input"]) || findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(valueValue)
      didSetValue = true
    }
  }
  if (!didSetPlaceholder && placeholderValue !== undefined && placeholderValue !== null) {
    const anyText = findTextNode(instance, ["placeholder"]) || findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(placeholderValue)
      didSetPlaceholder = true
    }
  }
  if (iconValue) {
    const instanceName = normalizeName(instance.name)
    const mainName = instance.mainComponent ? normalizeName(instance.mainComponent.name) : ""
    const isIconInstance = instanceName.indexOf("icon/") === 0 || mainName.indexOf("icon/") === 0
    const iconFallback = replaceCTAText !== null ? "Icon/Plus" : null
    if (isIconInstance) {
      const target = await resolveComponentForSwap(iconValue, componentMap)
        || (iconFallback ? await resolveComponentForSwap(iconFallback, componentMap) : null)
      if (target) {
        instance.swapComponent(target)
      }
    }
    let iconNode = instance.findOne(n => n.type === "INSTANCE" && n.name.toLowerCase().includes("icon"))
    if (!iconNode) {
      iconNode = instance.findOne(n => n.type === "INSTANCE" && normalizeName(n.name) === "icon/placeholder")
    }
    if (iconNode) {
      const target = await resolveComponentForSwap(iconValue, componentMap)
        || (iconFallback ? await resolveComponentForSwap(iconFallback, componentMap) : null)
      if (target) {
        iconNode.swapComponent(target)
      }
    }
  }

  // CTA button: apply the icon from the Icon/Placeholder child.
  // Tries INSTANCE_SWAP component property first, then falls back to direct
  // swapComponent on the nested icon instance. Always uses "Icon/Plus" as
  // the final fallback so Icon/Placeholder is never left in the CTA button.
  if (replaceCTAText !== null && Array.isArray(data.children) && data.children.length) {
    const iconChild = data.children.find(c => {
      const cn = normalizeName((c && c.componentName) || (c && c.name) || "")
      return cn === "icon/placeholder" && c.meta && c.meta.icon
    })
    if (iconChild) {
      const ctaIconValue = iconChild.meta.icon
      const ctaIconTarget = await resolveComponentForSwap(ctaIconValue, componentMap)
        || await resolveComponentForSwap("Icon/Plus", componentMap)
      if (ctaIconTarget) {
        // 1. Try via INSTANCE_SWAP component property
        let swappedViaProperty = false
        if (instance.componentProperties) {
          for (const [key, prop] of Object.entries(instance.componentProperties)) {
            if (prop && prop.type === "INSTANCE_SWAP") {
              try {
                instance.setProperties({ [key]: ctaIconTarget })
                swappedViaProperty = true
              } catch (_) {}
              break
            }
          }
        }
        // 2. Fallback: directly swap the nested Icon/Placeholder instance
        if (!swappedViaProperty) {
          const iconInst = findChildInstanceByKey(instance, "icon/placeholder")
          if (iconInst) {
            swapInstanceWithCorrectSize(iconInst, ctaIconTarget)
          }
        }
      }
    }
  }

  if (Array.isArray(data.children) && data.children.length) {
    for (const child of data.children) {
      if (!child) continue
      const childMeta = child.meta || {}
      const childName = (childMeta.componentName !== undefined && childMeta.componentName !== null)
        ? childMeta.componentName
        : (child.componentName !== undefined && child.componentName !== null)
          ? child.componentName
          : child.name
      if (!childName) continue
      const childInstance = findChildInstanceByKey(instance, childName)
      if (!childInstance) continue
      await applyMetaToInstance(childInstance, child, componentMap)
    }
  }
}

async function renderNode(data, parent, componentMap) {
  if (!data || typeof data !== "object") return

  let node = null
  const nodeName = data.componentName || (data.meta && data.meta.componentName) || data.name || ""
  const meta = data.meta || {}

  if (data.type === "FRAME") {
    const baseName = data.base
    const baseNode = baseName ? getComponentNodeByName(baseName) : null
    if (baseNode && (baseNode.type === "FRAME" || baseNode.type === "GROUP")) {
      node = baseNode.clone()
      try {
        node.resizeWithoutConstraints(getNumber(data.width, 1440), getNumber(data.height, 900))
      } catch (_) {}
      // Hide module.placeholder — the slot module will be placed at its position
      const placeholder = node.findOne(n => n.name === "module.placeholder")
      if (placeholder) placeholder.visible = false
    } else {
      node = figma.createFrame()
      node.resizeWithoutConstraints(
        getNumber(data.width, 1440),
        getNumber(data.height, 900)
      )
      node.layoutMode =
        data.layoutMode !== undefined && data.layoutMode !== null
          ? data.layoutMode
          : "NONE"
    }
  } else if (data.type === "RECTANGLE") {
    node = figma.createRectangle()
    node.resize(
      getNumber(data.width, 100),
      getNumber(data.height, 100)
    )
  } else if (data.type === "TEXT") {
    node = figma.createText()
    await figma.loadFontAsync({ family: "Inter", style: "Regular" })
    node.characters = data.characters || ""
  } else if (data.type === "SLOT") {
    if (meta.visible === false) {
      return
    }
    const name = nodeName || data.name
    const localNode = getComponentNodeByName(name)
    if (localNode) {
      if (localNode.type === "COMPONENT_SET") {
        const variant = pickVariantFromSet(localNode, data)
        node = variant ? variant.createInstance() : localNode.defaultVariant.createInstance()
      } else {
        node = localNode.createInstance()
      }
    } else {
      const key = data.componentKey || componentMap[name]
      if (!key) {
        console.warn("Component not found:", name)
        return
      }
      try {
        const component = await figma.importComponentByKeyAsync(key)
        node = component.createInstance()
      } catch (err) {
        console.warn("Component import failed:", key)
        return
      }
    }
  } else if (data.type === "INSTANCE") {
    const name = nodeName
    const localNode = getComponentNodeByName(name)
    if (localNode) {
      if (localNode.type === "COMPONENT_SET") {
        const variant = pickVariantFromSet(localNode, data)
        node = variant ? variant.createInstance() : localNode.defaultVariant.createInstance()
      } else if (localNode.type === "FRAME" || localNode.type === "GROUP") {
        // Slot frames are local FRAME/GROUP nodes — clone them instead of createInstance
        node = localNode.clone()
        node.x = 0
        node.y = 0
      } else {
        node = localNode.createInstance()
      }
    } else {
      const key = data.componentKey || componentMap[name]
      if (!key) {
        console.warn("Component not found:", name)
        return
      }
      try {
        const component = await figma.importComponentByKeyAsync(key)
        node = component.createInstance()
      } catch (err) {
        console.warn("Component import failed:", key)
        return
      }
    }
  }

  if (!node) return

  if (data.name) node.name = data.name
  if (data.type !== "INSTANCE") {
    if (Number.isFinite(data.x)) node.x = data.x
    if (Number.isFinite(data.y)) node.y = data.y
  }
  if (data.type === "INSTANCE" && node.type === "INSTANCE") {
    try {
      await applyMetaToInstance(node, data, componentMap)
    } catch (err) {
      console.warn("applyMetaToInstance failed:", err)
    }
  }
  // Generic childOverrides — applies regardless of whether node resolved as INSTANCE or cloned FRAME
  if (Array.isArray(data.childOverrides) && data.childOverrides.length) {
    applyChildOverrides(node, data.childOverrides)
  }

  // Apply subhead.form / form.footer overrides here (outside applyMetaToInstance)
  // because slot.module.form is often a cloned FRAME, not an INSTANCE
  if ((normalizeName(nodeName) === "slot.module.form" || normalizeName(nodeName) === "slot.module.wizardform") && data.meta) {
    const fMeta = data.meta
    const formTitle = fMeta.formTitle || null
    const formCtaText = fMeta.ctaText || null
    const formHintText = fMeta.hintText || null

    // Apply a text value: component property first, then direct TEXT node, then global scan
    const stripKey = s => String(s || "").toLowerCase().replace(/[\s.\-_]/g, "")
    const matchesKey = (nodeName, propKey) => {
      const norm = normalizeName(nodeName)
      if (norm.includes(propKey)) return true
      // Also match stripped: "Hint Text" → "hinttext" matches "replace.hinttext" → shortKey "hinttext"
      const shortKey = propKey.replace(/^replace\./, "")
      return stripKey(nodeName).includes(stripKey(shortKey))
    }
    const applyFormText = async (scopeNode, rootNode, propKey, value) => {
      if (!value) return
      // 1. Component property on the scoped container
      const container = scopeNode || rootNode
      const props = (container && container.componentProperties) || {}
      let applied = false
      for (const [key, prop] of Object.entries(props)) {
        if (prop.type === "TEXT" && matchesKey(String(key), propKey)) {
          try { container.setProperties({ [key]: value }); applied = true } catch (_) {}
        }
      }
      if (applied) return
      // 2. Named TEXT node inside scoped container
      const searchNode = scopeNode || rootNode
      if (searchNode) {
        const textNode = searchNode.findOne(n => n.type === "TEXT" && matchesKey(n.name, propKey))
        if (textNode) {
          try { await figma.loadFontAsync(textNode.fontName); textNode.characters = value; return } catch (_) {}
        }
      }
      // 3. Fallback: scan entire slot.module.form frame
      if (scopeNode && rootNode) {
        const globalText = rootNode.findOne(n => n.type === "TEXT" && matchesKey(n.name, propKey))
        if (globalText) {
          try { await figma.loadFontAsync(globalText.fontName); globalText.characters = value } catch (_) {}
        }
      }
    }

    const subheadNode = node.findOne(n => normalizeName(n.name) === "subhead.form")
    const footerNode = node.findOne(n => normalizeName(n.name) === "form.footer")

    // DEBUG: log what nodes are found and what text nodes exist
    console.warn("[form-debug] slot.module.form meta:", JSON.stringify({ formTitle, formCtaText, formHintText }))
    console.warn("[form-debug] subheadNode:", subheadNode ? subheadNode.name : "NOT FOUND")
    console.warn("[form-debug] footerNode:", footerNode ? footerNode.name : "NOT FOUND")
    // Log all child node names inside slot.module.form for inspection
    const allTextNodes = node.findAll(n => n.type === "TEXT")
    console.warn("[form-debug] all TEXT nodes in slot.module.form:", allTextNodes.map(n => n.name + " (norm:" + normalizeName(n.name) + ")").join(" | "))
    if (footerNode) {
      const footerChildren = footerNode.findAll(n => n.type === "TEXT")
      console.warn("[form-debug] TEXT nodes inside form.footer:", footerChildren.map(n => n.name + " (norm:" + normalizeName(n.name) + ")").join(" | "))
    }

    if (formTitle) await applyFormText(subheadNode, node, "replace.formtitle", formTitle)
    if (formCtaText) await applyFormText(footerNode, node, "replace.ctatext", formCtaText)
    if (formHintText) await applyFormText(footerNode, node, "replace.hinttext", formHintText)
  }

  // Apply selected item info to details module headers (card and table share same structure)
  if ((normalizeName(nodeName) === "slot.module.details.card" || normalizeName(nodeName) === "slot.module.details.table") && data.meta) {
    const { selectedCardName, selectedCardIcon, avatarConfig: avatarCfg } = data.meta

    if (selectedCardName) {
      // Find appicon.avatar inside common.detailview.header or anywhere in the module
      const headerNode = node.findOne(n => normalizeName(n.name) === "common.detailview.header")
      const searchRoot = headerNode || node
      const avatarNode = searchRoot.findOne(n => {
        if (n.type !== "INSTANCE") return false
        const mn = normalizeName(n.mainComponent ? (n.mainComponent.parent ? n.mainComponent.parent.name : n.mainComponent.name) : "")
        const nn = normalizeName(n.name || "")
        return mn === "appicon.avatar" || nn === "appicon.avatar"
      })
      if (avatarNode) {
        // Apply avatar type/border/status variants to match the card
        if (avatarCfg) {
          applyNamedVariants(avatarNode, {
            "Avatar Type": avatarCfg.type || "Solid",
            "Border Radius": avatarCfg.borderRadius || "Default",
            "Status Hint": avatarCfg.statusHint || false
          })
        }
        // Set appicon color + initials
        const appiconNode = avatarNode.findOne(n => {
          if (n.type !== "INSTANCE") return false
          const mn = normalizeName(n.mainComponent ? (n.mainComponent.parent ? n.mainComponent.parent.name : n.mainComponent.name) : "")
          const nn = normalizeName(n.name || "")
          return mn === "appicon" || nn === "appicon"
        })
        if (appiconNode) {
          if (avatarCfg && avatarCfg.type === "Solid" && avatarCfg.color) {
            applyNamedVariants(appiconNode, { "Color": avatarCfg.color, "Inverse": false })
          }
          if (selectedCardIcon) {
            const iconTextNode = appiconNode.findOne(n => n.type === "TEXT" && normalizeName(n.name) === "replace.appicon")
            if (iconTextNode) {
              try { await figma.loadFontAsync(iconTextNode.fontName); iconTextNode.characters = selectedCardIcon } catch (_) {}
            }
          }
        }
        // Set appname text inside avatar (handles both "replace.appname" and typo "repalce.appname")
        const appNameInAvatar = avatarNode.findOne(function(n) {
          if (n.type !== "TEXT") return false
          const nn = normalizeName(n.name || "")
          return nn === "replace.appname" || nn === "repalce.appname"
        })
        if (appNameInAvatar) {
          try { await figma.loadFontAsync(appNameInAvatar.fontName); appNameInAvatar.characters = selectedCardName } catch (_) {}
        }
      }
      // Apply replace.appname anywhere in the full module (handles typo variant too)
      const allAppNameNodes = node.findAll(function(n) {
        if (n.type !== "TEXT") return false
        const nn = normalizeName(n.name || "")
        return nn === "replace.appname" || nn === "repalce.appname"
      })
      for (var _i = 0; _i < allAppNameNodes.length; _i++) {
        try { await figma.loadFontAsync(allAppNameNodes[_i].fontName); allAppNameNodes[_i].characters = selectedCardName } catch (_) {}
      }

      // For details table: populate repalce.detailshead in common.detailview.header
      if (normalizeName(nodeName) === "slot.module.details.table") {
        const _headerNode = node.findOne(function(n) { return normalizeName(n.name || "") === "common.detailview.header" })
        if (_headerNode) {
          const _detailsHead = _headerNode.findOne(function(n) {
            return n.type === "TEXT" && normalizeName(n.name || "") === "repalce.detailshead"
          })
          if (_detailsHead) {
            try { await figma.loadFontAsync(_detailsHead.fontName); _detailsHead.characters = selectedCardName } catch (_) {}
          }
        }
      }
    }
  }

  if (parent) {
    parent.appendChild(node)
  }

  if (node && node.type === "INSTANCE" && isSlotName(nodeName) && parent) {
    const align = (meta && meta.layoutAlign) || "CENTER"
    if (parent.layoutMode && parent.layoutMode !== "NONE") {
      node.layoutAlign = align
    } else if (Number.isFinite(parent.width) && Number.isFinite(node.width)) {
      node.x = (parent.width - node.width) / 2
    }
  }

  if (Array.isArray(data.children)) {
    const isClonedSlot = isSlotName(nodeName) && (node.type === "FRAME" || node.type === "GROUP")
    const isInstanceSlot = isSlotName(nodeName) && node.type === "INSTANCE"

    if (isClonedSlot) {
      // Cloned slot FRAME/GROUP — check if children contain nested content slots
      const hasNestedSlots = data.children.some(c => isSlotName(c.componentName || c.name || ""))
      if (hasNestedSlots) {
        // Module slot: find each nested content slot inside the clone and apply its children
        for (const child of data.children) {
          if (!child) continue
          const childSlotName = child.componentName || child.name || ""
          if (!isSlotName(childSlotName)) continue
          // Search by exact name first, then by normalized name (handles case differences)
          var nestedSlot = node.findOne(n => n.name === childSlotName)
          if (!nestedSlot) {
            var _needle = normalizeName(childSlotName)
            nestedSlot = node.findOne(function(n) { return normalizeName(n.name || "") === _needle })
          }
          if (nestedSlot && Array.isArray(child.children) && child.children.length) {
            try {
              await applySlotChildren(nestedSlot, child.children, componentMap)
            } catch (err) {
              console.warn("applySlotChildren failed for nested slot:", childSlotName, err)
            }
          } else if (!nestedSlot) {
            console.warn("Nested slot not found in cloned module:", childSlotName, "| Module:", nodeName)
          }
        }
      } else {
        // Content slot: apply field children to existing instances inside the clone
        try {
          await applySlotChildren(node, data.children, componentMap)
        } catch (err) {
          console.warn("applySlotChildren failed:", nodeName, err)
        }
      }
    } else if (node.type !== "INSTANCE") {
      for (const child of data.children) {
        // If this child is a slot.* that already exists inside the cloned base frame,
        // apply its children to the existing node instead of creating a duplicate
        var childSlotName = child && (child.componentName || child.name || "")
        if (isSlotName(childSlotName)) {
          var existingInBase = node.findOne(function(n) { return normalizeName(n.name || "") === normalizeName(childSlotName) })
          if (existingInBase) {
            // Apply children if present
            if (Array.isArray(child.children) && child.children.length) {
              try {
                await applySlotChildren(existingInBase, child.children, componentMap)
              } catch (err) {
                console.warn("applySlotChildren to existing base slot failed:", childSlotName, err)
              }
            }
            // Apply meta text replacements (e.g. slot.wizard.hint with hintText)
            if (child.meta && child.meta.hintText) {
              var hintTextNode = existingInBase.findOne(function(n) { return n.type === "TEXT" })
              if (hintTextNode) {
                try { await figma.loadFontAsync(hintTextNode.fontName); hintTextNode.characters = child.meta.hintText } catch (_) {}
              }
            }
            continue
          }
        }
        // If this child matches an existing INSTANCE in the base by name, apply meta to it
        // (handles wizard.header and other non-slot components already in the cloned base)
        if (childSlotName && child.meta) {
          var existingComp = node.findOne(function(n) {
            if (n.type !== "INSTANCE") return false
            var mc = n.mainComponent
            if (mc && mc.parent && mc.parent.type === "COMPONENT_SET") {
              return normalizeName(mc.parent.name) === normalizeName(childSlotName)
            }
            return normalizeName(n.name || "") === normalizeName(childSlotName)
          })
          if (existingComp) {
            // Apply visibility
            if (child.meta.visible !== undefined) {
              existingComp.visible = !!child.meta.visible
            }
            // Apply variant state
            if (child.meta.variantState) {
              try { applyVariantState(existingComp, { variantState: child.meta.variantState }) } catch (_) {}
            }
            // Apply text replacements
            var textNodes = existingComp.findAll(function(n) { return n.type === "TEXT" })
            if (child.meta.wizardTitle && textNodes[0]) {
              try { await figma.loadFontAsync(textNodes[0].fontName); textNodes[0].characters = child.meta.wizardTitle } catch (_) {}
            }
            if (child.meta.wizardSubText && textNodes[1]) {
              try { await figma.loadFontAsync(textNodes[1].fontName); textNodes[1].characters = child.meta.wizardSubText } catch (_) {}
            }
            continue
          }
        }
        await renderNode(child, node, componentMap)
      }
      if (node.type === "FRAME") {
        applyFrameLayout(node)
      }
    } else if (isInstanceSlot) {
      try {
        await applySlotChildren(node, data.children, componentMap)
      } catch (err) {
        console.warn("applySlotChildren failed:", err)
      }
    }
  }

  return node
}

// ─── Render Rules ─────────────────────────────────────────────────────────────
// Two cases only:
//   All "Default" → first child becomes "Active", rest stay "Default"
//   All "Filled"  → no change, leave everything as-is

function findFormContentSlots(frame) {
  var slots = []
  var children = frame.children || []

  // Path 1: slot.module.form → slot.content.form
  var moduleSlot = children.find(function(c) {
    return String(c.componentName || c.name || "") === "slot.module.form"
  })
  if (moduleSlot) {
    var cs = (moduleSlot.children || []).find(function(c) {
      return String(c.componentName || c.name || "") === "slot.content.form"
    })
    if (cs) slots.push(cs)
  }

  // Path 2: slot.overlay.* → slot.content.form (composed overlay popup)
  for (var i = 0; i < children.length; i++) {
    var child = children[i]
    if (!String(child.name || "").startsWith("slot.overlay.")) continue
    var overlayChildren = child.children || []
    for (var j = 0; j < overlayChildren.length; j++) {
      if (String(overlayChildren[j].componentName || overlayChildren[j].name || "") === "slot.content.form") {
        slots.push(overlayChildren[j])
      }
    }
  }
  return slots
}

function applyRenderRules(nodes) {
  for (const frame of nodes) {
    if (!frame || frame.type !== "FRAME") continue

    var contentSlots = findFormContentSlots(frame)
    for (var si = 0; si < contentSlots.length; si++) {
      var contentSlot = contentSlots[si]
      if (!Array.isArray(contentSlot.children) || contentSlot.children.length === 0) continue

      var states = contentSlot.children.map(function(c) {
        return String((c.meta && c.meta.variantState) || "").toLowerCase()
      })

      var allDefault = states.every(function(s) { return s === "default" || s === "" })
      if (!allDefault) continue

      // Safety net: if all states are default, promote first field to hover-on-default
      var first = contentSlot.children[0]
      if (first) {
        first.meta = Object.assign({}, first.meta, { variantState: "hover-on-default" })
      }
    }
  }
}
async function renderUI(json) {
  const nodes = Array.isArray(json) ? json : [json]
  const componentMap = buildComponentKeyMap()
  if (!getComponentNodeByName("slot.module.table") && !getComponentNodeByName("slot.module.dashboard")) {
    console.warn("No slot.module.* frames found — run syncKnowledge and confirm slots exist in Figma.")
  }

  applyRenderRules(nodes)

  const created = []
  const margin = 80
  let currentY = 0
  for (const item of nodes) {
    try {
      const rendered = await renderNode(item, figma.currentPage, componentMap)
      if (rendered) {
        if (rendered.type === "FRAME") {
          rendered.x = 0
          rendered.y = currentY
          currentY += rendered.height + margin
        }
        created.push(rendered)
      }
    } catch (err) {
      console.warn("Render failed:", item && item.name, err)
    }
  }

  return created
}
