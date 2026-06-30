// renderer/applyMetaToInstance.js
// Applies all overrides from JSON meta to a Figma instance node.
// Calls applyVariantState first, then applyInstanceOverrides for other properties.

async function applyMetaToInstance(instance, data, componentMap) {
  const meta = data.meta || {}

  const visibleValue = meta.visible != null ? meta.visible : data.visible
  const enabledValue = meta.enabled != null ? meta.enabled : data.enabled
  const replaceLabelText = meta["replace.labelText"] != null ? meta["replace.labelText"] : null
  const replaceInputValue = meta["replace.inputValue"] != null ? meta["replace.inputValue"] : null
  const labelValue = replaceLabelText !== null
    ? replaceLabelText
    : (meta.label != null ? meta.label : data.label)
  const valueValue = meta.value != null
    ? meta.value
    : (data.value != null ? data.value : replaceInputValue)
  const placeholderValue = replaceInputValue !== null
    ? replaceInputValue
    : (meta.placeholder != null ? meta.placeholder : data.placeholder)
  const iconValue = meta.icon != null ? meta.icon : data.icon

  if (visibleValue === false) {
    instance.visible = false
  }
  if (enabledValue === false) {
    instance.opacity = 0.5
  }

  // 1. Apply variant state (validated, exact-match, never throws)
  applyVariantState(instance, meta)

  // 2. Apply other component property overrides
  try {
    await applyInstanceOverrides(instance, data, componentMap)
  } catch (err) {
    console.warn("applyInstanceOverrides failed:", err)
  }

  // 3. Text layer fallbacks (when component properties are unavailable)
  let didSetLabel = false
  let didSetValue = false
  let didSetPlaceholder = false

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

  if (!didSetLabel && labelValue != null) {
    const labelNode = findTextNode(instance, ["label"])
    if (labelNode) {
      await figma.loadFontAsync(labelNode.fontName)
      labelNode.characters = String(labelValue)
      didSetLabel = true
    }
  }

  if (!didSetValue && valueValue != null) {
    const valueNode = findTextNode(instance, ["value", "text", "input"])
    if (valueNode) {
      await figma.loadFontAsync(valueNode.fontName)
      valueNode.characters = String(valueValue)
      didSetValue = true
    }
  }

  if (!didSetPlaceholder && placeholderValue != null) {
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

  if (!didSetLabel && labelValue != null) {
    const anyText = findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(labelValue)
      didSetLabel = true
    }
  }

  if (!didSetValue && valueValue != null) {
    const anyText = findTextNode(instance, ["value", "input"]) || findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(valueValue)
      didSetValue = true
    }
  }

  if (!didSetPlaceholder && placeholderValue != null) {
    const anyText = findTextNode(instance, ["placeholder"]) || findFirstTextNode(instance)
    if (anyText) {
      await figma.loadFontAsync(anyText.fontName)
      anyText.characters = String(placeholderValue)
      didSetPlaceholder = true
    }
  }

  // 4. Icon swap on the instance itself or a nested icon child
  if (iconValue) {
    const instanceName = normalizeName(instance.name)
    const mainName = instance.mainComponent ? normalizeName(instance.mainComponent.name) : ""
    const isIconInstance = instanceName.indexOf("icon/") === 0 || mainName.indexOf("icon/") === 0
    if (isIconInstance) {
      const target = await resolveComponentForSwap(iconValue, componentMap)
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
      if (target) {
        iconNode.swapComponent(target)
      }
    }
  }

  // 5. Recurse into declared children
  if (Array.isArray(data.children) && data.children.length) {
    for (const child of data.children) {
      if (!child) continue
      const childMeta = child.meta || {}
      const childName = childMeta.componentName != null
        ? childMeta.componentName
        : (child.componentName != null ? child.componentName : child.name)
      if (!childName) continue
      const childInstance = findChildInstanceByKey(instance, childName)
      if (!childInstance) continue
      await applyMetaToInstance(childInstance, child, componentMap)
    }
  }
}
