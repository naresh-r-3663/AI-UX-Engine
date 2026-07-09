function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function containsExactPhrase(prompt, exactPrompt) {
  const normalizedPrompt = normalize(prompt)
  const normalizedExact = normalize(exactPrompt)
  if (!normalizedPrompt || !normalizedExact) return false
  return (` ${normalizedPrompt} `).includes(` ${normalizedExact} `)
}

function containsExactConcept(prompt, exactPrompt) {
  const normalizedPrompt = normalize(prompt)
  const normalizedExact = normalize(exactPrompt)
  if (!normalizedPrompt || !normalizedExact) return false

  const promptTokens = normalizedPrompt.split(" ").filter(Boolean)
  const exactTokens = normalizedExact.split(" ").filter(Boolean)
  if (!exactTokens.length) return false

  // Allow singular/plural match: "application" matches "applications" and vice versa
  function tokenMatch(token, list) {
    const base = (token.length > 3 && token.endsWith("s")) ? token.slice(0, -1) : token
    return list.some(function(t) {
      const tBase = (t.length > 3 && t.endsWith("s")) ? t.slice(0, -1) : t
      return base === tBase
    })
  }

  return exactTokens.every(function(token) { return tokenMatch(token, promptTokens) })
}

function shouldUseAI(prompt, domain) {
  if (domain?.source !== "domain-models") return true
  if (domain?.matchType === "exact") return false

  // Trust any keyword match — domain scoring already validates match quality
  if (domain?.matchType === "keyword") {
    return false
  }

  return true
}

module.exports = {
  shouldUseAI
}
