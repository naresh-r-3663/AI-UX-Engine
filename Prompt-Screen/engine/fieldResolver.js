const fallbackFields = require("../ai/fieldFallbackGenerator")

function normalize(text){
  return String(text || "").toLowerCase()
}

async function resolveFields(prompt, domainModel = {}, screen = {}){
  const step = normalize(screen.step || "")
  const useAI = screen?.useAI !== false
  const aiConfig = screen?.aiConfig
  if(step === "list" || step === "success" || step === "dashboard" || step === "details"){
    return []
  }

  // Keep user-management deterministic from domain knowledge as requested.
  if (domainModel?.name === "user" && Array.isArray(domainModel.fields) && domainModel.fields.length) {
    return domainModel.fields.map(field => ({
      label: field.label || field.name || null,
      type: field.type || "text",
      icon: field.icon || null,
      placeholder: field.placeholder || field.label || field.name || null,
      enabled: field.enabled !== false,
      visible: field.visible !== false
    }))
  }

  // For all non-user flows, prefer Ollama-generated fields whenever AI is enabled.
  if (useAI) {
    const aiFirstFields = await fallbackFields(prompt, { useAI: true, aiConfig })
    if (Array.isArray(aiFirstFields) && aiFirstFields.length) {
      return aiFirstFields
    }
  }

  if(Array.isArray(domainModel.fields) && domainModel.fields.length){
    return domainModel.fields.map(field => ({
      label: field.label || field.name || null,
      type: field.type || "text",
      icon: field.icon || null,
      placeholder: field.placeholder || field.label || field.name || null,
      enabled: field.enabled !== false,
      visible: field.visible !== false
    }))
  }

  return await fallbackFields(prompt, { useAI, aiConfig })
}

module.exports = resolveFields
