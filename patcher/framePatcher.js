// patcher/framePatcher.js
// Applies structured patch ops to a rendered frame JSON node.
//
// INSTANCE op:         { find: "comp.input.dropdown", nth: 0, set: { variantState: "Active" } }
// SLOT_INSTRUCTION op: { find: "card", nth: 2, set: { cardState: "Card Hover" } }

function collectNodes(node, result) {
  if (!result) result = []
  if (node.type === "INSTANCE" && node.componentName) result.push(node)
  if (node.type === "SLOT_INSTRUCTION" && node.role)   result.push(node)
  if (Array.isArray(node.children)) {
    node.children.forEach(function(child) { collectNodes(child, result) })
  }
  return result
}

function applyOp(frame, op) {
  if (!op || !op.find) return { ok: false, reason: "op missing 'find'" }

  const find  = String(op.find).toLowerCase()
  const nodes = collectNodes(frame)

  const matches = nodes.filter(function(n) {
    if (n.type === "SLOT_INSTRUCTION") {
      // Match by role (e.g. "card", "row")
      return String(n.role || "").toLowerCase() === find
    }
    // Match by componentName prefix (e.g. "comp.input.dropdown")
    return String(n.componentName || "").toLowerCase().startsWith(find)
  })

  const nth    = (op.nth !== undefined && op.nth !== null) ? op.nth : 0
  const target = matches[nth]
  if (!target) {
    return { ok: false, reason: `No node matching "${op.find}" at nth=${nth} (found ${matches.length} total)` }
  }

  const set = op.set || {}

  if (target.type === "SLOT_INSTRUCTION") {
    // Write any field directly onto the SLOT_INSTRUCTION node
    Object.keys(set).forEach(function(key) { target[key] = set[key] })
  } else {
    // INSTANCE node
    if (!target.meta) target.meta = {}
    if (set.variantState !== undefined) target.meta.variantState = set.variantState
    if (set.visible      !== undefined) { target.meta.visible = set.visible; target.visible = set.visible }
    if (set.enabled      !== undefined) { target.meta.enabled = set.enabled; target.enabled = set.enabled }
  }

  return { ok: true, targetName: target.name }
}

function patchFrame(frame, ops) {
  if (!Array.isArray(ops) || !ops.length) return { frame, errors: [] }

  const errors = []
  for (var i = 0; i < ops.length; i++) {
    const result = applyOp(frame, ops[i])
    if (!result.ok) errors.push(result.reason)
  }
  return { frame, errors }
}

module.exports = patchFrame
