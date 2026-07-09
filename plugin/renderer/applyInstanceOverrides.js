// renderer/applyInstanceOverrides.js
// Handles component property overrides (text, icon, enabled state).
// Variant state is handled separately by applyVariantState (see applyMetaToInstance.js).

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

async function applyInstanceOverrides(instance, data, componentMap) {
  if (!instance || !instance.componentProperties) return

  const props = instance.componentProperties
  const meta = data.meta || {}

  const replaceLabelText = meta["replace.labelText"] != null ? meta["replace.labelText"] : null
  const replaceInputValue = meta["replace.inputValue"] != null ? meta["replace.inputValue"] : null
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

  // Icon (by prop name match)
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

  // replace.labelText
  if (replaceLabelText !== null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("replace.labeltext")) {
        try {
          instance.setProperties({ [key]: String(replaceLabelText) })
          didSetLabel = true
        } catch (err) {
          console.warn("Property override skipped:", key, replaceLabelText)
        }
      }
    }
  }

  // replace.inputValue
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

  // label
  if (labelText != null) {
    for (const [key, prop] of Object.entries(props)) {
      const propName = normalizePropName(prop && prop.name)
      if (prop && prop.type === "TEXT" && propName.includes("label")) {
        try {
          instance.setProperties({ [key]: String(labelText) })
          didSetLabel = true
        } catch (err) {
          console.warn("Property override skipped:", key, labelText)
        }
      }
    }
  }

  // value / text
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

  // placeholder / hint
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

  // enabled / disabled boolean
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

  // Icon fallback — any INSTANCE_SWAP
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

  // Placeholder fallback — match by current value text
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

  // Value fallback — set empty or dash slots
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
