const fs = require("fs")
const path = require("path")
const { resolveComponentKey } = require("../engine/componentKeyLoader")

// ─── Card dashboard knowledge ─────────────────────────────────────────────────
const CARD_KNOWLEDGE_PATH = path.join(__dirname, "..", "knowledge", "cards", "knw-card-dashboard.json")
let _cardKnowledge = null

function loadCardKnowledge() {
  if (_cardKnowledge) return _cardKnowledge
  try {
    _cardKnowledge = JSON.parse(fs.readFileSync(CARD_KNOWLEDGE_PATH, "utf8"))
  } catch (_) {
    _cardKnowledge = {
      solidColors: ["Cardinal", "Tekhelete", "Caribbean", "Avocado", "Russet", "Penred", "Mardigrass", "Biceblue"],
      imageUsers: ["Dev", "Linda", "Neo", "Anna"],
      peopleDomainKeywords: ["user", "users", "people", "person", "member", "employee", "staff", "team", "customer", "client"],
      appNames: ["Nexus", "Orbit", "Pulse", "Vortex", "Atlas", "Prism", "Beacon", "Catalyst", "Horizon", "Zenith"]
    }
  }
  return _cardKnowledge
}

function isPeopleDomain(prompt) {
  const knowledge = loadCardKnowledge()
  const words = String(prompt || "").toLowerCase().split(/\W+/).filter(Boolean)
  return words.some(w => knowledge.peopleDomainKeywords.includes(w))
}

function randomCreatedOn() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const now = new Date()
  const past = new Date(now.getTime() - Math.random() * 365 * 24 * 60 * 60 * 1000)
  const d = String(past.getDate()).padStart(2, "0")
  return `${months[past.getMonth()]} ${d}, ${past.getFullYear()}`
}

function toAppIconInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "??"
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join("").toUpperCase().slice(0, 3)
}

// ─── Access log row generation ────────────────────────────────────────────────

var ACCESS_LOG_NAMES = [
  "Alice Johnson", "Bob Martinez", "Carol White", "David Chen",
  "Emma Wilson", "Frank Garcia", "Grace Lee", "Henry Brown",
  "Isabella Davis", "James Taylor", "Karen Anderson", "Liam Thomas",
  "Mia Jackson", "Noah Harris", "Olivia Moore", "Patrick Clark",
  "Quinn Lewis", "Rachel Walker", "Samuel Hall", "Tina Allen"
]

var ACCESS_LOG_RECENCY = [
  "2 min ago", "5 min ago", "12 min ago", "18 min ago", "25 min ago",
  "1 hr ago", "2 hrs ago", "3 hrs ago", "Yesterday", "2 days ago"
]

const MIN_FORM_FIELDS = 4
const MAX_FORM_FIELDS = 7

function deriveAccessRoles(prompt) {
  var p = String(prompt || "").toLowerCase()
  if (/\b(llm|model|api|provider|inference)\b/.test(p)) {
    return ["API User", "Developer", "Admin", "ML Engineer", "Ops Team"]
  }
  if (/\b(book|appoint|schedul|patient|doctor|clinic)\b/.test(p)) {
    return ["Patient", "Doctor", "Receptionist", "Admin", "Nurse"]
  }
  if (/\b(vendor|supplier|purchas|order|inventory)\b/.test(p)) {
    return ["Buyer", "Supplier", "Manager", "Admin", "Auditor"]
  }
  if (/\b(user|member|staff|team|employee|people)\b/.test(p)) {
    return ["Super Admin", "Admin", "Member", "Viewer", "Editor"]
  }
  return ["Admin", "Member", "Viewer", "Editor", "Guest"]
}

function deriveItemTypes(prompt) {
  var p = String(prompt || "").toLowerCase()
  if (/\b(shoe|sneaker|footwear|boot|sandal|heel|lace|sole)\b/.test(p)) {
    return ["Casual", "Sport", "Formal", "Running", "Lifestyle"]
  }
  if (/\b(furniture|sofa|chair|table|wardrobe|bed|shelf|desk)\b/.test(p)) {
    return ["Seating", "Storage", "Sleeping", "Dining", "Decor"]
  }
  if (/\b(book|library|course|education|content|article)\b/.test(p)) {
    return ["Fiction", "Non-Fiction", "Reference", "Education", "Science"]
  }
  if (/\b(product|item|inventory|stock|catalog|goods)\b/.test(p)) {
    return ["Category A", "Category B", "Category C", "Premium", "Standard"]
  }
  if (/\b(device|hardware|gadget|electronics|tech)\b/.test(p)) {
    return ["Mobile", "Laptop", "Tablet", "Accessory", "Wearable"]
  }
  return ["Type A", "Type B", "Type C", "Premium", "Standard"]
}

function buildDomainTableRows(prompt, count, resolvedNames, rowHoverFirst) {
  var total = count || 10
  var knowledge = loadCardKnowledge()
  var isPeople = isPeopleDomain(prompt)

  // Shuffled status pool: ~70% Active, ~30% Inactive
  var activeCount = Math.round(total * 0.7)
  var statusPool = []
  for (var _s = 0; _s < total; _s++) {
    statusPool.push(_s < activeCount ? "Active" : "Inactive")
  }
  for (var _j = statusPool.length - 1; _j > 0; _j--) {
    var _r = Math.floor(Math.random() * (_j + 1))
    var _tmp = statusPool[_j]; statusPool[_j] = statusPool[_r]; statusPool[_r] = _tmp
  }

  var rows = []

  if (isPeople) {
    // People/user domain: use real person names, emails, and roles
    var roles = deriveAccessRoles(prompt)
    var namePool = (Array.isArray(resolvedNames) && resolvedNames.length > 0)
      ? resolvedNames
      : ACCESS_LOG_NAMES
    for (var i = 0; i < total; i++) {
      var name = namePool[i % namePool.length] || ("User " + (i + 1))
      var role = roles[i % roles.length]
      var email = toAccessEmail(name)
      var createdOn = randomCreatedOn()
      rows.push({
        type: "SLOT_INSTRUCTION",
        role: "table-item",
        name: name,
        status: statusPool[i],
        lastactive: createdOn,
        rowHover: rowHoverFirst && i === 0,
        replacements: {
          "replace.username": name,
          "replace.usertype": role,
          "replace.email": email
        }
      })
    }
  } else {
    var types = deriveItemTypes(prompt)
    var namePool = (Array.isArray(resolvedNames) && resolvedNames.length > 0)
      ? resolvedNames
      : knowledge.appNames
    for (var i = 0; i < total; i++) {
      var name = namePool[i % namePool.length] || ("Item " + (i + 1))
      var type = types[i % types.length]
      var initials = toAppIconInitials(name)
      var code = initials + "-" + (100 + i)
      var createdOn = randomCreatedOn()
      rows.push({
        type: "SLOT_INSTRUCTION",
        role: "table-item",
        name: name,
        status: statusPool[i],
        lastactive: createdOn,
        rowHover: rowHoverFirst && i === 0,
        replacements: {
          "replace.username": name,
          "replace.usertype": type,
          "replace.email": code
        }
      })
    }
  }

  return rows
}

function toAccessEmail(name) {
  var parts = String(name || "").toLowerCase().split(/\s+/)
  if (parts.length >= 2) return parts[0] + "." + parts[1] + "@company.com"
  return (parts[0] || "user") + "@company.com"
}

function shuffledCopy(items) {
  var arr = items.slice()
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1))
    var tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

function pickAccessLogNames(total) {
  var pool = shuffledCopy(ACCESS_LOG_NAMES)
  var names = []
  for (var i = 0; i < total; i++) {
    var name = pool[i % pool.length]
    if (i >= pool.length) {
      // Keep names unique even when total exceeds source pool.
      name = name + " " + String(Math.floor(i / pool.length) + 2)
    }
    names.push(name)
  }
  return names
}

function buildAccessLogRows(prompt, count) {
  var total = count || 10
  var roles = deriveAccessRoles(prompt)
  var names = pickAccessLogNames(total)
  var recencyPool = shuffledCopy(ACCESS_LOG_RECENCY)
  var rows = []
  for (var i = 0; i < total; i++) {
    var name = names[i]
    var role = roles[i % roles.length]
    var email = toAccessEmail(name)
    var recency = recencyPool[i % recencyPool.length]
    rows.push({
      type: "SLOT_INSTRUCTION",
      role: "table-item",
      name: name,
      replacements: {
        // Keep both keys because different detail-table variants bind either
        // replace.name or replace.username in component properties.
        "replace.name": name,
        "replace.username": name,
        "replace.type": role,
        "replace.email": email,
        "replace.active": recency
      }
    })
  }
  return rows
}

function buildDashboardCards(cardState, prompt, count, resolvedNames, startColorIndex, preGeneratedDates) {
  const knowledge = loadCardKnowledge()
  const total = count || 15
  const isImage = isPeopleDomain(prompt)
  const namePool = (Array.isArray(resolvedNames) && resolvedNames.length)
    ? resolvedNames
    : knowledge.appNames
  const colorStart = startColorIndex || 0
  const cards = []

  for (let i = 0; i < total; i++) {
    const rawName = namePool[i % namePool.length] || `Item ${i + 1}`
    const appName = rawName.length > 20 ? rawName.slice(0, 20).trimEnd() : rawName
    const appIcon = toAppIconInitials(appName)
    const textLength = rawName.length > 25 ? "Ellipsis" : "Default"
    const createdOn = (preGeneratedDates && preGeneratedDates[i]) ? preGeneratedDates[i] : randomCreatedOn()
    const avatarConfig = isImage
      ? {
          type: "Image",
          borderRadius: "Default",
          statusHint: true,
          color: null,
          userVariant: knowledge.imageUsers[i % knowledge.imageUsers.length]
        }
      : {
          type: "Solid",
          borderRadius: "Default",
          statusHint: false,
          color: knowledge.solidColors[(colorStart + i) % knowledge.solidColors.length],
          userVariant: null
        }

    cards.push({
      type: "SLOT_INSTRUCTION",
      role: "card",
      name: appName,
      cardState: cardState || null,
      appName,
      appIcon,
      textLength,
      createdOn,
      avatarConfig
    })
  }

  return cards
}

// Build a reverse lookup: alias word → icon name, from knw-icons.json
function buildIconAliasIndex() {
  const iconsPath = path.join(__dirname, "..", "knowledge", "components", "knw-icons.json")
  try {
    const data = JSON.parse(fs.readFileSync(iconsPath, "utf8"))
    const index = new Map() // alias → icon name
    for (const icon of (data.icons || [])) {
      for (const alias of (icon.aliases || [])) {
        const key = String(alias).toLowerCase()
        if (!index.has(key)) index.set(key, icon.name)
      }
    }
    return index
  } catch (_) {
    return new Map()
  }
}

const _iconAliasIndex = buildIconAliasIndex()

function isFormSlot(slotName){
  return String(slotName || "").toLowerCase().includes("form")
}

function isTableSlot(slotName){
  const name = String(slotName || "").toLowerCase()
  return name.includes("table") || name.includes("list")
}

function isCardsSlot(slotName){
  return String(slotName || "").toLowerCase().includes("card")
}

function isDashboardSlot(slotName){
  return String(slotName || "").toLowerCase().includes("dashboard")
}

function buildFieldInstances(mappedFields = []){
  return mappedFields.map((field, index) => ({
    type: "INSTANCE",
    name: field.label || field.componentName,
    componentKey: resolveComponentKey(field.componentName),
    componentName: field.componentName,
    meta: {
      componentName: field.componentName,
      label: field.label || null,
      icon: field.icon || null,
      index,
      visible: field.visible !== false,
      value: field.value ?? null,
      enabled: field.enabled !== false
    },
    icon: field.icon || undefined,
    value: field.value ?? undefined,
    enabled: field.enabled !== false,
    visible: field.visible !== false ? undefined : false
  }))
}

function buildTableInstances(mappedFields = [], rowState = null, childOverrides = null){
  const fields = mappedFields.length
    ? mappedFields
    : [
        { componentName: "comp.input.text.base", label: "Column 1" },
        { componentName: "comp.input.text.base", label: "Column 2" },
        { componentName: "comp.input.text.base", label: "Column 3" }
      ]

  return fields.map((field, index) => ({
    type: "SLOT_INSTRUCTION",
    role: "tableColumn",
    name: field.label || `Column ${index + 1}`,
    rowState: rowState || null,
    // childOverrides only on first column (row[0]) so the plugin applies it once per row
    ...(childOverrides && index === 0 ? { childOverrides } : {}),
    componentName: field.componentName,
    meta: {
      label: field.label || null,
      icon: field.icon || null,
      index
    }
  }))
}


function inferIconForType(type){
  switch(String(type || "").toLowerCase()){
    case "textarea":
      return "Icon/Text-document"
    case "dropdown":
      return "Icon/Dropdown"
    case "date":
      return "Icon/Clock"
    case "number":
      return "Icon/Number"
    case "email":
      return "Icon/Email"
    case "phone":
      return "Icon/Mobile"
    case "password":
      return "Icon/Lock-on"
    case "checkbox":
      return "Icon/Tick-small"
    case "button":
      return "Icon/Tag-tick"
    default:
      return "Icon/Input-text"
  }
}

function inferIconForLabel(label){
  const words = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

  for (const word of words) {
    const icon = _iconAliasIndex.get(word)
    if (icon) return icon
  }
  return null
}

function inferContextualValue(label, type, firstCardName) {
  const labelLow = String(label || "").toLowerCase()
  const t = String(type || "").toLowerCase()

  if (t === "date") return new Date().toISOString().slice(0, 10)
  if (t === "email") return "user@example.com"
  if (t === "phone") return "9999999999"
  if (t === "password") return "••••••••"

  if (t === "number") {
    if (/price|cost|amount|fee/.test(labelLow)) return "99"
    if (/rating|score|rank/.test(labelLow)) return "4"
    return "1"
  }

  if (t === "dropdown") {
    if (/status/.test(labelLow)) return "Active"
    if (/category|type|genre/.test(labelLow)) return "Category A"
    if (/brand/.test(labelLow)) return firstCardName ? firstCardName.split(/\s+/)[0] : "Brand A"
    return "Option 1"
  }

  if (t === "textarea") {
    return firstCardName ? `Details about ${firstCardName}.` : "Sample description."
  }

  // Text fields — label keyword matching
  if (/\bname\b|\btitle\b/.test(labelLow) && firstCardName) return firstCardName
  if (/\bbrand\b/.test(labelLow)) return firstCardName ? firstCardName.split(/\s+/)[0] : "Brand A"
  if (/\bmodel\b/.test(labelLow)) return "Model X1"
  if (/\bnumber\b/.test(labelLow)) return "001"
  if (/\bimage\b|\bphoto\b|\bpicture\b/.test(labelLow)) return "item-001.jpg"
  if (/\bdescription\b|\bnotes\b|\bdetail\b/.test(labelLow)) return firstCardName ? `Details about ${firstCardName}.` : "Sample description."
  if (/\btag\b/.test(labelLow)) return "featured"
  if (/\bcolor\b/.test(labelLow)) return "Red"
  if (/\bsize\b/.test(labelLow)) return "M"
  if (/\baddress\b/.test(labelLow)) return "123 Main St"

  return label ? `${label} Value` : "Sample"
}

function normalizeFormFieldCount(inputFields = []) {
  var capped = inputFields.slice(0, MAX_FORM_FIELDS)
  if (capped.length >= MIN_FORM_FIELDS) {
    return capped
  }

  var fillerLabels = ["Additional Info", "Reference", "Remarks", "Notes"]
  var nextIndex = 0
  while (capped.length < MIN_FORM_FIELDS) {
    var fallbackLabel = fillerLabels[nextIndex] || ("Field " + String(capped.length + 1))
    capped.push({
      componentName: "comp.input.text.base",
      type: "text",
      label: fallbackLabel,
      icon: null,
      placeholder: fallbackLabel,
      enabled: true,
      visible: true,
      value: null
    })
    nextIndex++
  }
  return capped
}

function buildFieldInstancesWithState(mappedFields = [], inputState = "default", context = {}){
  const inputFields = normalizeFormFieldCount(
    mappedFields.filter(field => String(field.componentName || "").startsWith("comp.input."))
  )
  const filled = inputState === "filled"
  const firstCardName = context.firstCardName || null

  return inputFields.map((field, index) => {
    const label = field.label || field.componentName
    const icon = field.icon || inferIconForLabel(label) || inferIconForType(field.type)
    const placeholder = `Add ${label}`
    const value = filled ? (field.value ?? inferContextualValue(field.label, field.type, firstCardName)) : field.value
    const fieldType = String(field.type || "").toLowerCase()
    const fieldChildComponent = fieldType === "dropdown"
      ? "input.dropdown.feild"
      : fieldType === "textarea"
        ? "input.textarea.feild"
        : "input.text.feild"
    const hintText = field.hint || null

    let variantState = "default"
    if(inputState === "filled") variantState = "filled"
    else if(inputState === "hover" && index === 0) variantState = "hover-on-default"

    // Apply index-targeted childOverrides (e.g. disable the first field)
    var overrides = context.childOverrides || []
    for (var oi = 0; oi < overrides.length; oi++) {
      var ov = overrides[oi]
      if (ov.index !== index) continue
      var ovName = String(ov.childName || "").toLowerCase().trim()
      var fieldName = String(field.componentName || "").toLowerCase().trim()
      var nameMatch = !ov.childName || fieldName === ovName || fieldName.startsWith(ovName)
      if (!nameMatch) continue
      var ovProp = String(ov.property || "").toLowerCase()
      if (ovProp === "state" || ovProp === "variantstate") variantState = ov.value
    }

    return {
      type: "INSTANCE",
      name: label,
      componentKey: resolveComponentKey(field.componentName),
      componentName: field.componentName,
      meta: {
        componentName: field.componentName,
        "replace.labelText": label,
        index,
        visible: field.visible !== false,
        "replace.inputValue": value ?? null,
        enabled: field.enabled !== false,
        variantState
      },
      enabled: field.enabled !== false,
      visible: field.visible !== false ? undefined : false,
      children: [
        {
          type: "INSTANCE",
          name: label,
          componentKey: resolveComponentKey("input.common.label"),
          componentName: "input.common.label",
          meta: { "replace.labelText": label }
        },
        {
          type: "INSTANCE",
          name: fieldChildComponent,
          componentKey: resolveComponentKey(fieldChildComponent),
          componentName: fieldChildComponent,
          meta: {
            placeholder,
            "replace.inputValue": value ?? null
          },
          children: [
            {
              type: "INSTANCE",
              name: "Icon/Placeholder",
              componentKey: resolveComponentKey("Icon/Placeholder"),
              componentName: "Icon/Placeholder",
              meta: { icon }
            }
          ]
        },
        {
          type: "INSTANCE",
          name: "input.common.hint",
          componentKey: resolveComponentKey("input.common.hint"),
          componentName: "input.common.hint",
          meta: hintText
            ? { "replace.inputValue": hintText }
            : { placeholder: placeholder }
        }
      ]
    }
  })
}

function generateSlotChildren(slotName, mappedFields, context){
  mappedFields = mappedFields || []
  context = context || {}

  if(isFormSlot(slotName)){
    var inputState = (context.screen && context.screen.inputState) ? context.screen.inputState : "default"
    var firstCardName = (context.screen && context.screen._newCardName)
      ? context.screen._newCardName
      : (context.screen && context.screen._cardNames && context.screen._cardNames[0]) ? context.screen._cardNames[0] : null
    var fieldOverrides = (context.screen && context.screen.childOverrides) ? context.screen.childOverrides : []
    return buildFieldInstancesWithState(mappedFields, inputState, { firstCardName: firstCardName, childOverrides: fieldOverrides })
  }

  // Subtable slot → access log rows (same data as details-card)
  if (String(slotName || "").toLowerCase().indexOf("subtable") !== -1) {
    var _stPrompt = (context.screen && context.screen._prompt) ? context.screen._prompt : ""
    return buildAccessLogRows(_stPrompt, 10)
  }

  if(isTableSlot(slotName)){
    var stepId = (context.screen && context.screen.id) ? context.screen.id : ""
    var prompt = (context.screen && context.screen._prompt) ? context.screen._prompt : ""
    var resolvedNames = (context.screen && context.screen._cardNames) ? context.screen._cardNames : null
    var newItemName = (context.screen && context.screen._newCardName) ? context.screen._newCardName : null
    // Base pool excludes resolvedNames[0] (the new item) to avoid duplication
    var baseNames = (resolvedNames && resolvedNames.length > 1) ? resolvedNames.slice(1) : resolvedNames

    if (stepId === "table") {
      return buildDomainTableRows(prompt, 10, baseNames, false)
    }

    if (stepId === "table-success") {
      var baseRows = buildDomainTableRows(prompt, 10, baseNames, false)
      if (newItemName) {
        var newRow = buildDomainTableRows(prompt, 1, [newItemName], false)[0]
        return [newRow].concat(baseRows)
      }
      return baseRows
    }

    if (stepId === "table-row-hover") {
      var baseRowsH = buildDomainTableRows(prompt, 10, baseNames, false)
      if (newItemName) {
        var newRowH = buildDomainTableRows(prompt, 1, [newItemName], false)[0]
        newRowH.rowHover = true
        return [newRowH].concat(baseRowsH)
      }
      if (baseRowsH.length > 0) baseRowsH[0].rowHover = true
      return baseRowsH
    }

    // details.table is a pure container — its only child is the subtable
    // added by layoutBuilder's subSlot logic. Return empty so no fake
    // comp.input.text.base tableColumn items are injected.
    if (String(slotName || "").toLowerCase().indexOf("details") !== -1) {
      return []
    }

    // Fallback: column definitions (used by other table variants)
    var rowState      = (context.screen && context.screen.rowState)      ? context.screen.rowState      : null
    var childOverrides = (context.screen && context.screen.childOverrides) ? context.screen.childOverrides : null
    return buildTableInstances(mappedFields, rowState, childOverrides)
  }

  if(isCardsSlot(slotName) || isDashboardSlot(slotName)){
    const stepId = context?.screen?.id || ""
    const prompt = context?.screen?._prompt || context?._prompt || ""
    const resolvedNames = context?.screen?._cardNames || context?._cardNames || null
    const newCardName = context?.screen?._newCardName || null

    // Build new card object (from frame 03's first field value)
    // Generate the new card date once and reuse across all frames
    const newCardDate_seed = randomCreatedOn()
    let newCard = null
    if (newCardName) {
      const knowledge = loadCardKnowledge()
      const isImage = isPeopleDomain(prompt)
      const appIcon = toAppIconInitials(newCardName)
      const textLength = newCardName.length > 25 ? "Ellipsis" : "Default"
      const avatarConfig = isImage
        ? { type: "Image", borderRadius: "Default", statusHint: true, color: null, userVariant: knowledge.imageUsers[0] }
        : { type: "Solid", borderRadius: "Default", statusHint: false, color: knowledge.solidColors[0], userVariant: null }
      const displayName = newCardName.length > 20 ? newCardName.slice(0, 20).trimEnd() : newCardName
      newCard = {
        type: "SLOT_INSTRUCTION",
        role: "card",
        name: displayName,
        cardState: null,
        appName: displayName,
        appIcon,
        textLength,
        createdOn: newCardDate_seed,
        avatarConfig
      }
    }

    // Base pool: skip resolvedNames[0] (it's the "new card") so the 14 background
    // cards don't duplicate the newly added item across all frames
    const baseNames = (resolvedNames && resolvedNames.length > 1)
      ? resolvedNames.slice(1)
      : resolvedNames

    // Base cards always start from solidColors[1] (index 1 = Tekhelete), because
    // the new card always uses solidColors[0] (Cardinal). Passing startColorIndex=1
    // ensures base cards cycle Tekhelete → Caribbean → Avocado → ... with no
    // Cardinal collision at position 0.
    const BASE_COLOR_OFFSET = 1

    // Pre-generate dates once so all frames share the same dates
    const baseDates = []
    for (let i = 0; i < 15; i++) baseDates.push(randomCreatedOn())
    const newCardDate = newCard ? newCard.createdOn : newCardDate_seed

    // Frame 01: 14 base cards, no hover
    if (stepId === "dashboard") {
      return buildDashboardCards(null, prompt, 14, baseNames, BASE_COLOR_OFFSET, baseDates)
    }

    // Frame 04: new card at top + 14 base cards + toast
    if (stepId === "dashboard-success") {
      const base14 = buildDashboardCards(null, prompt, 14, baseNames, BASE_COLOR_OFFSET, baseDates)
      return newCard ? [{ ...newCard, createdOn: newCardDate }, ...base14] : base14
    }

    // Frame 05: new card (hover) at top + 14 base cards (default)
    if (stepId === "dashboard-card-hover") {
      const base14 = buildDashboardCards(null, prompt, 14, baseNames, BASE_COLOR_OFFSET, baseDates)
      if (newCard) {
        return [{ ...newCard, cardState: "Card Hover", createdOn: newCardDate }, ...base14]
      }
      return base14.map((c, i) => i === 0 ? { ...c, cardState: "Card Hover" } : c)
    }

    // Frame 06: access log table — who accessed the item (10 rows)
    if (stepId === "details-card" || slotName === "slot.content.details.card") {
      const rows = buildAccessLogRows(prompt, 10)
      const rowChildOverrides = context?.screen?.rowChildOverrides || null
      if (rowChildOverrides && rows.length > 0) {
        rows[0] = { ...rows[0], childOverrides: rowChildOverrides }
      }
      return rows
    }

    // Screen-list driven: apply cardState + childOverrides to first card only
    const cardState      = context?.screen?.cardState || null
    const childOverrides = context?.screen?.childOverrides || null
    const cardDates      = context?.screen?._cardDates || null
    const cards          = buildDashboardCards(null, prompt, 14, resolvedNames, 0, cardDates)

    if (cardState || childOverrides) {
      cards[0] = {
        ...cards[0],
        ...(cardState      ? { cardState }      : {}),
        ...(childOverrides ? { childOverrides }  : {})
      }
    }

    return cards
  }

  return []
}

module.exports = generateSlotChildren
module.exports.randomCreatedOn = randomCreatedOn
