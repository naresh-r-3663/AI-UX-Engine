function buildFlowA(domainTitle) {
  return [
    {
      id:          "table",
      name:        `01 ${domainTitle} List`,
      moduleSlot:  "slot.module.table",
      contentSlot: "slot.content.table",
      step:        "table"
    },
    {
      id:          "form-hover",
      name:        `02 Add ${domainTitle}`,
      moduleSlot:  "slot.module.form",
      contentSlot: "slot.content.form",
      inputState:  "hover",
      step:        "form"
    },
    {
      id:          "form-filled",
      name:        `03 Filled ${domainTitle} Form`,
      moduleSlot:  "slot.module.form",
      contentSlot: "slot.content.form",
      inputState:  "filled",
      step:        "filledForm"
    },
    {
      id:          "table-success",
      name:        `04 ${domainTitle} Added`,
      moduleSlot:  "slot.module.table",
      contentSlot: "slot.content.table",
      toast:       true,
      step:        "table"
    },
    {
      id:          "table-row-hover",
      name:        `05 ${domainTitle} Select Row`,
      moduleSlot:  "slot.module.table",
      contentSlot: "slot.content.table",
      rowState:    "Row Hover",
      step:        "table"
    },
    {
      id:          "details-table",
      name:        `06 ${domainTitle} Details`,
      moduleSlot:  "slot.module.details.table",
      contentSlot: "slot.content.details.table",
      subSlot:     "slot.content.details.subtable",
      step:        "details"
    }
  ]
}

function buildFlowB(domainTitle) {
  return [
    {
      id:          "dashboard",
      name:        `01 ${domainTitle} Dashboard`,
      moduleSlot:  "slot.module.dashboard",
      contentSlot: "slot.content.card-dashboard",
      step:        "dashboard"
    },
    {
      id:          "form-hover",
      name:        `02 Add ${domainTitle}`,
      moduleSlot:  "slot.module.form",
      contentSlot: "slot.content.form",
      inputState:  "hover",
      step:        "form"
    },
    {
      id:          "form-filled",
      name:        `03 Filled ${domainTitle} Form`,
      moduleSlot:  "slot.module.form",
      contentSlot: "slot.content.form",
      inputState:  "filled",
      step:        "filledForm"
    },
    {
      id:          "dashboard-success",
      name:        `04 ${domainTitle} Added`,
      moduleSlot:  "slot.module.dashboard",
      contentSlot: "slot.content.card-dashboard",
      toast:       true,
      step:        "dashboard"
    },
    {
      id:          "dashboard-card-hover",
      name:        `05 ${domainTitle} Select Card`,
      moduleSlot:  "slot.module.dashboard",
      contentSlot: "slot.content.card-dashboard",
      cardState:   "card-hover",
      step:        "dashboard"
    },
    {
      id:          "details-card",
      name:        `06 ${domainTitle} Details`,
      moduleSlot:  "slot.module.details.card",
      contentSlot: "slot.content.details.card",
      step:        "details"
    }
  ]
}

function buildFlowC(domainTitle) {
  var labels = ["Basic Info", "Configuration", "Permissions", "Review"]
  return [
    {
      id:          "wizard-step1",
      name:        "01 " + domainTitle + " Basic Info",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "form",
      base:        "page.full-wizard",
      _wizardStep: 1,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step1-filled",
      name:        "02 " + domainTitle + " Basic Info Filled",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "filledForm",
      base:        "page.full-wizard",
      _wizardStep: 1,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step2",
      name:        "03 " + domainTitle + " Configuration",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "form",
      base:        "page.full-wizard",
      _wizardStep: 2,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step2-filled",
      name:        "04 " + domainTitle + " Configuration Filled",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "filledForm",
      base:        "page.full-wizard",
      _wizardStep: 2,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step3",
      name:        "05 " + domainTitle + " Permissions",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "form",
      base:        "page.full-wizard",
      _wizardStep: 3,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step3-filled",
      name:        "06 " + domainTitle + " Permissions Filled",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "filledForm",
      base:        "page.full-wizard",
      _wizardStep: 3,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "wizard-step4",
      name:        "07 " + domainTitle + " Review",
      moduleSlot:  "slot.module.wizardform",
      contentSlot: "slot.content.form",
      step:        "form",
      base:        "page.full-wizard",
      _wizardStep: 4,
      _wizardTotal: 4,
      _wizardLabels: labels
    },
    {
      id:          "dashboard-success",
      name:        "08 " + domainTitle + " Created",
      moduleSlot:  "slot.module.dashboard",
      contentSlot: "slot.content.card-dashboard",
      toast:       true,
      step:        "dashboard"
    }
  ]
}

function generateFlow(prompt = "", domain = {}) {
  const normalized = String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const tokens = new Set(normalized.split(" ").filter(Boolean))
  const domainTitle = domain.title || "System"

  const wizardKeywords = ["wizard", "stepper", "multi step", "multistep", "step by step"]
  const tableKeywords = ["table", "list", "log", "logs", "manage", "management"]
  const dashboardKeywords = ["dashboard", "grid", "card"]

  const isWizardFlow = wizardKeywords.some(kw => normalized.includes(kw))
  if (isWizardFlow) return buildFlowC(domainTitle)

  const isTableFlow = tableKeywords.some(kw => tokens.has(kw))
  if (isTableFlow) return buildFlowA(domainTitle)

  const isDashboardFlow = dashboardKeywords.some(kw => tokens.has(kw))
  if (isDashboardFlow) return buildFlowB(domainTitle)

  return buildFlowA(domainTitle)
}

module.exports = generateFlow
