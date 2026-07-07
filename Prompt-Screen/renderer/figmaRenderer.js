function isSlot(node){
  const name = node?.name || node?.componentName || ""
  return String(name).startsWith("slot.")
}

function normalizeNode(node){
  if(!node || typeof node !== "object"){
    return node
  }

  const normalized = { ...node }

  if(Array.isArray(normalized.children)){
    normalized.children = normalized.children.map(child => normalizeNode(child))
  }

  return normalized
}

function normalizeFrames(frames = []){
  return frames.map(frame => ({
    ...frame,
    children: Array.isArray(frame?.children)
      ? frame.children.map(child => normalizeNode(child))
      : frame?.children
  }))
}

function createRenderPlan(frames = []){
  const actions = []

  frames.forEach(frame => {
    if(!frame){
      return
    }
    actions.push({
      action: "createFrame",
      name: frame.name,
      width: frame.width,
      height: frame.height,
      base: frame.base
    })

    ;(frame.children || []).forEach(child => {
      if(!child){
        return
      }
      if(isSlot(child)){
        actions.push({
          action: "createInstance",
          name: child.name,
          componentName: child.componentName,
          meta: { slot: true }
        })
        actions.push({
          action: "updateSlotLayers",
          slotName: child.name,
          instructions: child.children || []
        })
        return
      }

      actions.push({
        action: "createInstance",
        name: child.name,
        componentName: child.componentName,
        meta: child.meta || null
      })
    })
  })

  return actions
}

function figmaRenderer(frames = [], options = {}){
  const mode = options.mode || "json"
  const normalizedFrames = normalizeFrames(frames)
  if(mode === "json"){
    return normalizedFrames
  }

  return createRenderPlan(normalizedFrames)
}

module.exports = figmaRenderer
