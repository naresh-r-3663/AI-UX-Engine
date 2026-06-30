const { buildHoverSummary } = require("./propertyResolver")

async function getFetch() {
  if (typeof fetch === "function") return fetch
  const mod = await import("node-fetch")
  return mod.default
}

async function ollamaGenerate(prompt) {
  if (process.env.OLLAMA_ENABLED === "false") return null
  const url   = process.env.OLLAMA_URL   || "http://127.0.0.1:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b"

  try {
    const fetchImpl = await getFetch()
    const res = await fetchImpl(`${url}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model, prompt, stream: false })
    })
    if (!res.ok) return null
    const data = await res.json()
    return String(data?.response || "").trim() || null
  } catch (_) {
    return null
  }
}

async function resolveWithAI(screenDesc, moduleKey) {
  const hoverSummary = buildHoverSummary()

  const prompt = `You resolve a UI screen description to a JSON object. Output ONLY valid JSON, nothing else.

Module: ${moduleKey || "dashboard"}
Screen: "${screenDesc}"

Rules:
- "success" or "added" means a toast notification is visible: use toast:true
- "hover on X close" or "hover on X dismiss" means the toast is visible AND its close icon is hovered
- "card hover" means a card is in hover state
- "hover on [menu item]" means that menu item is hovered in an open ellipsis menu
- "overlay delete and hover on [component]" means show the delete overlay AND apply hover to a child inside it: use overlayChildOverrides
- Use property "$hover" when hovering a component — it auto-detects BOOLEAN Hover or VARIANT State at runtime
- Use overlayChildOverrides to apply overrides to children inside the overlay popup
- Use childOverrides to apply overrides to children of cards or any other top-level component
- For color, state, or any property change use the exact Figma property name as "property" and the value as "value"

Component hover reference (exact property=value to use instead of $hover when you know the component):
${hoverSummary}

Valid JSON properties:
toast (boolean true), cardState (string), rowState (string), inputState (string), overlaySlot (string), menuItemHover (string), toastOverrides (array), childOverrides (array), overlayChildOverrides (array), rowChildOverrides (array)

cardState values: "Card Hover", "Card Ellipsis Hover", "Card Ellipsis Click"
rowState values: "Row Hover", "Row Ellipsis Hover", "Row Ellipsis Click"
inputState values: "hover", "filled"
overlaySlot values: "slot.overlay.delete"
menuItemHover values: "Access", "Edit", "Delete"
toastOverrides format: [{"childName":"action.modal.close","property":"State","value":"Hover-on-default"}]
overlayChildOverrides format: [{"childName":"comp.error.button","property":"$hover","value":true}]
childOverrides format: [{"childName":"input.check","property":"State","value":"checked"}]

Examples (input -> output):
"card hover" -> {"cardState":"Card Hover"}
"success" -> {"toast":true}
"overlay delete" -> {"overlaySlot":"slot.overlay.delete"}
"card ellipsis click hover delete" -> {"cardState":"Card Ellipsis Click","menuItemHover":"Delete"}
"hover on success close icon" -> {"toast":true,"toastOverrides":[{"childName":"action.modal.close","property":"State","value":"Hover-on-default"}]}
"hover on toast dismiss button" -> {"toast":true,"toastOverrides":[{"childName":"action.modal.close","property":"State","value":"Hover-on-default"}]}
"input hover" -> {"inputState":"hover"}
"overlay delete and hover on comp.error.button" -> {"overlaySlot":"slot.overlay.delete","overlayChildOverrides":[{"childName":"comp.error.button","property":"$hover","value":true}]}
"overlay delete hover confirm button" -> {"overlaySlot":"slot.overlay.delete","overlayChildOverrides":[{"childName":"comp.primary.button","property":"$hover","value":true}]}

Now resolve: "${screenDesc}"
JSON:`

  const raw = await ollamaGenerate(prompt)
  if (!raw) return null

  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (typeof parsed !== "object" || Array.isArray(parsed)) return null

    // Strip empty/null/false scalar values (keep arrays and explicit true)
    const clean = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.length > 0) { clean[k] = v; continue }
      if (v === true) { clean[k] = v; continue }
      if (typeof v === "string" && v.trim() !== "") { clean[k] = v; continue }
    }
    return Object.keys(clean).length > 0 ? clean : null
  } catch (_) {
    return null
  }
}

module.exports = resolveWithAI
