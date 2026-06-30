const path = require("path")
const fs   = require("fs")

let _map = null
function getMap() {
  if (_map) return _map
  try {
    _map = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "componentPropertyMap.json"), "utf8"))
  } catch (_) {
    _map = {}
  }
  return _map
}

// Look up the hover property+value for a component by name.
// Returns { property, value } or null if not found.
function resolveHoverForComponent(componentName) {
  const map   = getMap()
  const entry = map[componentName]
  if (!entry) return null
  for (const [propName, propDef] of Object.entries(entry)) {
    if (propDef.semantic === "hover") {
      return { property: propName, value: propDef.hoverValue }
    }
  }
  return null
}

// Replace $hover sentinels in a childOverrides array with exact property/value.
// childName is used as the component lookup key — works when childName === componentName.
// Overrides without $hover are passed through unchanged.
function resolveOverrideSentinels(overrides) {
  if (!Array.isArray(overrides)) return overrides
  return overrides.map(o => {
    if (o.property !== "$hover") return o
    const resolved = resolveHoverForComponent(o.childName)
    if (resolved) return { ...o, property: resolved.property, value: resolved.value }
    return o  // leave sentinel if component not in map (plugin handles it at runtime)
  })
}

// Return a one-line summary of all hover properties, used in AI prompts.
function buildHoverSummary() {
  const map = getMap()
  return Object.entries(map)
    .map(([name, props]) => {
      const hoverProp = Object.entries(props).find(([, d]) => d.semantic === "hover")
      if (!hoverProp) return null
      const [propName, propDef] = hoverProp
      return `${name}: set ${propName}=${propDef.hoverValue}`
    })
    .filter(Boolean)
    .join(" | ")
}

module.exports = { resolveOverrideSentinels, resolveHoverForComponent, buildHoverSummary }
