const path = require("path")
const fs = require("fs")

async function getFetch() {
  if (typeof fetch === "function") return fetch
  const mod = await import("node-fetch")
  return mod.default
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) } catch (_) { return null }
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*?\]/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch (_) { return null }
}

// ─── Extract what each card represents from the prompt ──────────────────────
// Strips UI/layout words to find the real entity.
// "software company dashboard in card ui" → "software company"
// "dashboard for youtube channel"         → "youtube channel"

const UI_NOISE_WORDS = [
  "dashboard", "grid", "app", "card", "cards", "ui", "ux", "page", "list",
  "table", "view", "panel", "screen", "layout", "design", "in", "for",
  "with", "the", "a", "an", "of", "my", "our", "create", "make", "build",
  "show", "display", "manage", "management"
]

function extractEntity(prompt) {
  const words = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  const meaningful = words.filter(function(w) { return UI_NOISE_WORDS.indexOf(w) === -1 })
  return meaningful.join(" ") || words.join(" ") || "item"
}

// ─── AI result validation ───────────────────────────────────────────────────
// Ollama often returns metrics, features, or categories instead of real names.
// Detect and reject these so the contextual fallback can take over.

const METRIC_PATTERNS = /\b(rate|count|growth|engagement|retention|coverage|frequency|speed|load|size|time|score|ratio|average|total|percent|index|volume|revenue|profit|cost|budget|margin|conversion|bounce|churn|latency|throughput|uptime|downtime|bandwidth|capacity|utilization|efficiency|performance|analytics|metric|stat|kpi|roi|ctr|cpc|cpm|cpa|ltv|arpu|dau|mau|wau|mrr|arr|nps|csat)\b/i

function looksLikeMetric(name) {
  return METRIC_PATTERNS.test(String(name || ""))
}

function validateAiNames(names) {
  if (!Array.isArray(names) || !names.length) return null
  // If more than 30% of names look like metrics/features, reject the entire batch
  const metricCount = names.filter(looksLikeMetric).length
  if (metricCount / names.length > 0.3) return null
  // Filter out individual bad names but keep the batch if mostly good
  return names.filter(function(n) { return !looksLikeMetric(n) })
}

// ─── Ollama AI resolution ───────────────────────────────────────────────────

async function resolveNamesWithOllama(prompt, count, options = {}) {
  const useAI = options.useAI !== false
  const enabled = useAI && process.env.OLLAMA_ENABLED !== "false"
  if (!enabled) return null

  const url = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b"

  const entity = extractEntity(prompt)

  const ollamaPrompt = [
    `You are generating realistic sample names for a dashboard UI.`,
    `Each card in the dashboard represents one specific "${entity}".`,
    `Generate ${count} real-world example names — concrete instances, NOT categories or features.`,
    "",
    "Rules:",
    `- Each name must be a specific, recognizable instance of "${entity}"`,
    "- 1 to 4 words each, max 30 characters",
    "- Use well-known real-world examples when possible",
    "- Do NOT return generic labels, types, features, metrics, or categories",
    "- Do NOT return analytics terms like Revenue, Engagement, Retention, Watch Time",
    "",
    "Examples of CORRECT output:",
    '  Prompt "youtube channel" → ["MrBeast", "T-Series", "PewDiePie", "Cocomelon", "SET India"]',
    '  Prompt "software company" → ["Atlassian", "Salesforce", "Slack", "GitHub", "Figma"]',
    '  Prompt "food" → ["Margherita Pizza", "Beef Burger", "Pad Thai", "Caesar Salad"]',
    '  Prompt "shoe" → ["Air Max 90", "Ultra Boost", "Chuck Taylor", "Old Skool"]',
    "",
    "Examples of WRONG output (do NOT do this):",
    '  "youtube channel" → ["Subscriber Count", "Watch Time", "Total Views"] ← these are metrics',
    '  "software company" → ["User Engagement", "Revenue Growth", "Error Rate"] ← these are metrics',
    '  "shoe" → ["Running", "Casual", "Formal"] ← these are categories',
    "",
    `Now generate ${count} names for: "${entity}"`,
    "Return ONLY a JSON array. No explanations, no markdown."
  ].join("\n")

  try {
    const fetchImpl = await getFetch()
    const response = await fetchImpl(`${url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: ollamaPrompt,
        stream: false,
        options: { temperature: 0.3 }
      })
    })
    if (!response.ok) return null
    const payload = await response.json()
    const text = String(payload?.response || "").trim()
    if (!text) return null
    const arr = extractJsonArray(text)
    if (!Array.isArray(arr) || !arr.length) return null
    const raw = arr.slice(0, count).map(n => String(n).trim()).filter(Boolean)
    // Validate: reject if AI returned metrics/features instead of real names
    return validateAiNames(raw)
  } catch (_) {
    return null
  }
}

// ─── People domain ──────────────────────────────────────────────────────────

const PERSON_NAMES = [
  "Alice Johnson", "Bob Martinez", "Carol White", "David Chen",
  "Emma Wilson", "Frank Garcia", "Grace Lee", "Henry Brown",
  "Isabella Davis", "James Taylor", "Karen Anderson", "Liam Thomas",
  "Mia Jackson", "Noah Harris", "Olivia Moore", "Patrick Clark",
  "Quinn Lewis", "Rachel Walker", "Samuel Hall", "Tina Allen"
]

const PEOPLE_KEYWORDS = ["user", "users", "people", "person", "member", "employee", "staff", "team", "customer", "client"]

// ─── Context-aware static fallback pools ────────────────────────────────────
// When AI is off, unreachable, or returns bad results, pick a pool that
// matches the prompt context. These are always reliable.
//
// Each pool has a "label" used to generate entity-aware fallback names when
// no pool matches exactly but the entity is close.

const CONTEXTUAL_POOLS = [
  { label: "company",
    keywords: ["company", "compony", "compny", "startup", "business", "org", "organisation", "organization", "enterprise", "firm", "software company", "tech company", "saas", "vendor", "agency"],
    names: ["Atlassian", "Salesforce", "Slack", "Figma", "GitHub", "Notion", "Stripe", "Vercel", "Linear", "Airtable", "Canva", "Dropbox", "Zoom", "Asana", "Twilio", "Datadog"] },
  { label: "youtube channel",
    keywords: ["channel", "youtube", "youtuber", "ytchannel", "yt channel", "youtube channel", "content creator", "creator", "streamer", "vlogger", "vlog"],
    names: ["MrBeast", "T-Series", "PewDiePie", "Cocomelon", "SET India", "Like Nastya", "Kids Diana", "Vlad & Niki", "Dude Perfect", "FilmTheory", "Veritasium", "MKBHD", "Casey Neistat", "Linus Tech", "Kurzgesagt", "Mark Rober"] },
  { label: "restaurant",
    keywords: ["restaurant", "food", "cafe", "dining", "recipe", "meal", "cuisine", "dish", "menu", "bistro", "eatery", "bakery", "pizzeria"],
    names: ["Margherita Pizza", "Beef Burger", "Pad Thai", "Caesar Salad", "Sushi Roll", "Tacos Al Pastor", "Ramen Tonkotsu", "Fish & Chips", "Butter Chicken", "Pho Bo", "Falafel Wrap", "Eggs Benedict", "Tom Yum Soup", "Bibimbap", "Churros", "Tiramisu"] },
  { label: "shoe",
    keywords: ["shoe", "shoes", "sneaker", "sneakers", "footwear", "boot", "boots"],
    names: ["Air Max 90", "Ultra Boost", "Chuck Taylor", "Old Skool", "Air Jordan 1", "NB 550", "Gel-Kayano", "Pegasus 40", "Stan Smith", "Yeezy 350", "Dunk Low", "Forum 84", "Suede Classic", "Gel-Lyte III", "990v6", "Gazelle"] },
  { label: "book",
    keywords: ["book", "books", "novel", "library", "reading", "author", "bookstore", "ebook"],
    names: ["The Alchemist", "Atomic Habits", "Sapiens", "Dune", "1984", "Educated", "The Hobbit", "Thinking Fast", "Zero to One", "Deep Work", "Outliers", "Ikigai", "Lean Startup", "The Subtle Art", "Quiet", "Shoe Dog"] },
  { label: "movie",
    keywords: ["movie", "movies", "film", "films", "cinema", "theatre", "theater", "streaming"],
    names: ["Inception", "Interstellar", "The Matrix", "Parasite", "Oppenheimer", "Dune Part Two", "Whiplash", "Arrival", "Coco", "Soul", "Joker", "The Batman", "Barbie", "Top Gun", "Everything EEAAO", "Spider-Verse"] },
  { label: "music",
    keywords: ["music", "song", "songs", "album", "albums", "artist", "band", "playlist", "track", "tracks", "singer", "podcast"],
    names: ["Bohemian Rhapsody", "Blinding Lights", "Shape of You", "Bad Guy", "Rolling Deep", "Starboy", "Levitating", "Heat Waves", "Cruel Summer", "Anti-Hero", "Flowers", "As It Was", "Peaches", "Stay", "Montero", "Dynamite"] },
  { label: "game",
    keywords: ["game", "games", "gaming", "gamer", "esport", "esports", "videogame"],
    names: ["Elden Ring", "Zelda TOTK", "Baldur's Gate 3", "God of War", "Hades", "Minecraft", "GTA V", "Fortnite", "Stardew Valley", "Hollow Knight", "Celeste", "Portal 2", "Cyberpunk 2077", "Red Dead 2", "Witcher 3", "Disco Elysium"] },
  { label: "project",
    keywords: ["project", "projects", "task", "tasks", "sprint", "workflow", "kanban", "backlog", "jira", "roadmap"],
    names: ["Auth Revamp", "API Gateway", "Dark Mode", "Mobile App v2", "Data Pipeline", "CI/CD Setup", "Search Rework", "Onboarding Flow", "Payment Module", "i18n Support", "SSO Migration", "Perf Audit", "Design Tokens", "Docs Portal", "Rate Limiter", "Feature Flags"] },
  { label: "product",
    keywords: ["product", "products", "item", "items", "inventory", "stock", "catalog", "catalogue", "gadget", "electronics", "device"],
    names: ["MacBook Pro", "iPhone 15", "Galaxy S24", "Pixel 8", "iPad Air", "AirPods Pro", "Echo Dot", "Kindle PW", "Surface Pro", "ThinkPad X1", "Steam Deck", "Quest 3", "PS5 Slim", "Switch OLED", "Dyson V15", "Roomba j7"] },
  { label: "course",
    keywords: ["course", "courses", "training", "learning", "tutorial", "class", "lesson", "workshop", "bootcamp", "certification", "education"],
    names: ["Intro to Python", "React Mastery", "Data Science 101", "UX Design Lab", "Cloud AWS", "Machine Learning", "SQL Bootcamp", "Figma Basics", "System Design", "DevOps Pipeline", "Cybersecurity", "Blockchain 101", "AI Prompt Eng", "Mobile Dev", "Agile Scrum", "TypeScript Pro"] },
  { label: "place",
    keywords: ["country", "countries", "city", "cities", "place", "places", "travel", "destination", "location", "hotel", "hotels", "resort", "trip"],
    names: ["Tokyo", "Paris", "New York", "London", "Dubai", "Singapore", "Barcelona", "Sydney", "Istanbul", "Bangkok", "Rome", "Cape Town", "Toronto", "Seoul", "Amsterdam", "Lisbon"] },
  { label: "vehicle",
    keywords: ["car", "cars", "vehicle", "vehicles", "automobile", "bike", "motorcycle", "truck", "fleet"],
    names: ["Tesla Model 3", "Toyota Camry", "Honda Civic", "BMW 3 Series", "Ford Mustang", "Audi A4", "Mercedes C-Class", "Porsche 911", "Hyundai Tucson", "Kia Sportage", "Mazda CX-5", "Subaru Outback", "Chevrolet Bolt", "Rivian R1T", "Jeep Wrangler", "Volvo XC60"] },
  { label: "property",
    keywords: ["property", "properties", "real estate", "realestate", "house", "apartment", "flat", "listing", "rental", "rent", "lease", "tenant"],
    names: ["Sunset Villa", "Park Avenue 4B", "Ocean View Apt", "Elm Street 22", "Hilltop Manor", "Downtown Loft", "Maple Residence", "River Edge 9A", "Cedar Heights", "Bay View Suite", "Lakefront 12C", "Garden Terrace", "Pine Ridge 3B", "Metro Studio", "Harbour Point", "Willow Creek"] },
  { label: "event",
    keywords: ["event", "events", "conference", "meetup", "webinar", "seminar", "workshop event", "hackathon", "summit", "festival"],
    names: ["React Conf 2025", "AWS re:Invent", "WWDC 2025", "Google I/O", "Design Week NYC", "DevOps Days", "PyCon US", "JSConf EU", "Product Hunt", "Figma Config", "GitHub Universe", "Web Summit", "CES 2025", "SXSW", "TechCrunch", "Startup Grind"] },
  { label: "social media",
    keywords: ["social media", "instagram", "twitter", "tiktok", "facebook", "linkedin", "influencer", "follower", "followers", "post", "posts", "profile", "profiles"],
    names: ["@natgeo", "@nike", "@nasa", "@therock", "@selenagomez", "@cristiano", "@kyliejenner", "@leomessi", "@beyonce", "@taylorswift", "@kimkardashian", "@justinbieber", "@arianagrande", "@kendalljenner", "@neymarjr", "@khloekardashian"] },
  { label: "application",
    keywords: ["application", "applications", "app dashboard", "application dashboard", "workspace", "product app", "project app"],
    names: ["Inventory Mgmt", "Vendor Portal", "User Tracking", "HR Onboarding", "Fleet Manager", "Sales CRM", "Order Fulfillment", "Asset Tracker", "Expense Manager", "Help Desk", "Payroll System", "Compliance Hub", "Booking Engine", "Analytics Suite", "Document Vault", "Approval Workflow"] }
]

// ─── Pool matching with fuzzy fallback ──────────────────────────────────────
// 1. Exact keyword substring match (fast, reliable)
// 2. Entity-word overlap scoring (catches cases where prompt wording differs
//    slightly from pool keywords)

// Word-boundary keyword test — prevents "booking" matching "book" or "tracker" matching "track"
function keywordInPrompt(promptLow, kw) {
  if (kw.includes(" ")) {
    // Multi-word keyword: exact substring is fine (e.g. "software company")
    return promptLow.indexOf(kw) !== -1
  }
  // Single-word keyword: require word boundary on both sides
  const re = new RegExp("(?:^|[^a-z])" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:[^a-z]|$)")
  return re.test(promptLow)
}

function pickStaticPool(prompt) {
  const promptLow = String(prompt || "").toLowerCase()

  // Pass 1: word-boundary keyword match (fast, reliable)
  for (const pool of CONTEXTUAL_POOLS) {
    if (pool.keywords.some(function(kw) { return keywordInPrompt(promptLow, kw) })) {
      return pool.names
    }
  }

  // Pass 2: entity-word overlap — extract meaningful words from the prompt
  // and see if any pool's keywords share words with the entity.
  // This catches prompts like "tech startup management" matching the company
  // pool via "startup" even if the exact substring check missed it.
  const entity = extractEntity(prompt)
  const entityWords = entity.split(/\s+/).filter(Boolean)
  if (entityWords.length === 0) return null

  let bestPool = null
  let bestOverlap = 0
  for (const pool of CONTEXTUAL_POOLS) {
    let overlap = 0
    for (const kw of pool.keywords) {
      const kwWords = kw.split(/\s+/)
      for (const ew of entityWords) {
        for (const kw2 of kwWords) {
          if (ew === kw2) overlap++
          // Catch single-char typos: "compony" vs "company" (edit distance ≤ 1)
          else if (ew.length > 3 && kw2.length > 3 && fuzzyMatch(ew, kw2)) overlap += 0.8
        }
      }
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestPool = pool
    }
  }

  // Require at least one meaningful word overlap
  if (bestPool && bestOverlap >= 0.8) return bestPool.names
  return null
}

// Simple fuzzy match: true if strings differ by at most 1 character (substitution, insertion, or deletion)
function fuzzyMatch(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a === b) return true
  // Same length: allow 1 substitution
  if (a.length === b.length) {
    let diffs = 0
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++
      if (diffs > 1) return false
    }
    return diffs === 1
  }
  // Length differs by 1: allow 1 insertion/deletion
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  let skipped = false
  for (let i = 0, j = 0; i < shorter.length; i++, j++) {
    if (shorter[i] !== longer[j]) {
      if (skipped) return false
      skipped = true
      j++ // skip one char in longer
      if (shorter[i] !== longer[j]) return false
    }
  }
  return true
}

// ─── Entity-aware fallback name generator ───────────────────────────────────
// When no static pool matches and AI is unavailable, generate names that
// reference the extracted entity so cards feel contextually relevant instead
// of completely generic.

function buildEntityFallbackNames(entity, count) {
  // Title-case the entity for display
  const titleEntity = entity
    .split(/\s+/)
    .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1) })
    .join(" ")

  // Use the entity as a prefix/suffix with distinguishing qualifiers
  const qualifiers = [
    "Alpha", "Beta", "Prime", "Core", "Plus", "Pro", "Nova", "Edge",
    "One", "Apex", "Lite", "Max", "Hub", "Arc", "Zen", "Neo"
  ]

  const names = []
  for (let i = 0; i < count; i++) {
    const qualifier = qualifiers[i % qualifiers.length]
    // Alternate between "Entity Qualifier" and "Qualifier Entity" patterns
    if (i % 2 === 0) {
      names.push(titleEntity + " " + qualifier)
    } else {
      names.push(qualifier + " " + titleEntity)
    }
  }
  return names
}

// ─── Main resolver ──────────────────────────────────────────────────────────

async function resolveItemNames(prompt, count, options = {}) {
  // For people/user domain: return real person names
  const promptWords = String(prompt || "").toLowerCase().split(/\W+/).filter(Boolean)
  if (promptWords.some(function(w) { return PEOPLE_KEYWORDS.indexOf(w) !== -1 })) {
    const names = []
    for (let i = 0; i < count; i++) {
      names.push(PERSON_NAMES[i % PERSON_NAMES.length])
    }
    return names
  }

  // Check if we have a known contextual pool — these are always reliable
  const contextPool = pickStaticPool(prompt)

  // Try AI only if no contextual pool exists (avoid Ollama returning bad results
  // when we already have curated data for the domain)
  let aiNames = null
  if (!contextPool) {
    aiNames = await resolveNamesWithOllama(prompt, count, options)
    if (aiNames && aiNames.length >= count) return aiNames.slice(0, count)
  }

  // Use contextual pool if available
  if (contextPool) {
    const names = []
    for (let i = 0; i < count; i++) {
      names.push(contextPool[i % contextPool.length])
    }
    // Overlay any partial AI results
    if (aiNames && aiNames.length > 0) {
      for (let i = 0; i < aiNames.length && i < count; i++) {
        names[i] = aiNames[i]
      }
    }
    return names
  }

  // No pool matched — build entity-aware fallback names instead of generic
  // "Nexus", "Orbit" names that have no relation to the prompt.
  const entity = extractEntity(prompt)
  if (entity && entity !== "item") {
    const fallback = buildEntityFallbackNames(entity, count)
    // Overlay any partial AI results
    if (aiNames && aiNames.length > 0) {
      for (let i = 0; i < aiNames.length && i < count; i++) {
        fallback[i] = aiNames[i]
      }
    }
    return fallback
  }

  // Absolute last resort: generic appNames from knowledge
  const knowledgePath = path.join(__dirname, "..", "knowledge", "cards", "knw-card-dashboard.json")
  const knowledge = readJson(knowledgePath) || {}
  const staticNames = knowledge.appNames || []

  const names = []
  for (let i = 0; i < count; i++) {
    names.push(staticNames[i % staticNames.length] || `Item ${i + 1}`)
  }
  if (aiNames && aiNames.length > 0) {
    for (let i = 0; i < aiNames.length && i < count; i++) {
      names[i] = aiNames[i]
    }
  }
  return names
}

module.exports = resolveItemNames
