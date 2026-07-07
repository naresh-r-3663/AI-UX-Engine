# AI UX Engine — Project Knowledge Export
**Exported: 2026-03-31**

---

## 1. User Profile

Builds and maintains a Figma plugin + Node.js engine that renders full UI screens from JSON screen-list definitions. Deep knowledge of Figma component architecture, plugin APIs, and design system structure. Prefers analyze-first-then-code workflow — often asks to analyze gaps before implementing. Iterates quickly between DS changes in Figma and engine code. Comfortable with both the plugin (Figma runtime) and engine (Node.js) sides.

---

## 2. Engine Architecture Overview

### Two-pass rendering system:
- **Pass 1:** `node aiuxengine.js --screen-list screen-list.json` — full render — render-output.json
- **Pass 2:** Patcher applies structured/NL ops from screen-list `patch` field

### Key pipeline files:
| File | Role |
|---|---|
| `screen-list.json` | Screen definitions (module, screen, base, fields, patch) |
| `screenResolver.js` | Resolves screen props from screenRegistry |
| `appOrchestrator.js` | Orchestrates field resolution, layout building |
| `layoutBuilder.js` | Builds JSON layout tree (slot-name driven) |
| `plugin/code.js` | Figma plugin renders JSON to real Figma frames |

### Flow:
```
Prompt -> AI resolves fields -> engine composes JSON -> plugin renders in Figma
```

All new features follow the same pipeline. Config-driven where possible (moduleRegistry, screenRegistry). Code changes only when new node types or rendering patterns are needed.

---

## 3. Composed Overlay System

### Architecture (built 2026-03-30):
- `modal.blanket` — COMPONENT, full-screen transparent backdrop
- `slot.overlay.popup` — FRAME, centered popup with slot.content.form inside
- `slot.overlay.delete` — FRAME, centered delete confirmation
- Any future `slot.overlay.*` follows same pattern

### Key decisions:
- `overlayCompose: true` flag in screenRegistry drives composition (not hardcoded names)
- Plugin detects composition by `modal.blanket` sibling presence — centers any `slot.overlay.*`
- `generateKnowledge.js` auto-registers new overlay FRAME types with `overlayCompose: true`
- Form fields injected into `slot.content.form` inside `slot.overlay.popup` via `generateSlotChildren`
- `slot.overlay.form` (old composite component) will be removed from DS once fully migrated

### Adding new overlays:
Create FRAME in DS -> sync -> auto-registered -> use `"screen": "overlay <name>"` in screen-list

---

## 4. Hybrid Field Resolution Chain

### Resolution priority (built 2026-03-30):
1. **`screen.fields`** — explicit fields in screen-list.json (full control, no AI)
2. **`domain.fieldCategories[screen.fieldCategory]`** — saved category from domain knowledge
3. **`domain.fields`** — flat field list (current default behavior)
4. **AI resolve** — generates dynamically (first-time only)

### Key files:
- `screenResolver.js` — passes `_explicitFields`, `_fieldCategory` to step
- `appOrchestrator.js` — resolution chain + `_fieldCategories` collection
- `runPromptUi.js` — persists `fieldCategories` via save-domain API
- `prompt-ui.html` — shows categories in save modal

### Domain save flow:
AI generates -> "Save as Domain Model" button -> user reviews -> confirms -> saved with `fieldCategories` to domainModels.json

### Usage:
- Wizard flows: use `"fields": [...]` per screen
- Reuse: save as domain with `fieldCategories` then use `"fieldCategory": "basic"`
- Single-form flows: unchanged (flat fields)

---

## 5. Per-Screen Page Base Support

### Built 2026-03-30:
- `moduleRegistry.json` has `"base"` per module (all default to `"page.base"`)
- `screen-list.json` can override with `"base": "page.full-wizard"` per screen
- Resolution: `screenEntry.base` -> `moduleDef.base` -> `"page.base"` fallback
- Plugin indexes all `page.*` FRAME nodes automatically — zero code changes for new page bases

### DS page bases:
| Base | Layout |
|---|---|
| `page.base` | Dashboard/table layout with nav + topbar |
| `page.full-wizard` | Full-page wizard layout |

### Adding new page bases:
Create new `page.*` FRAME in DS -> sync -> use `"base": "page.new-name"` in screen-list

---

## 6. DS Property Rename Handling

### DS rename (2026-03-30):
| Category | Before | After |
|---|---|---|
| Variant properties | `State`, `Size` | `state`, `size` |
| Variant values | `Hover On Default`, `Card Hover` | `hover-on-default`, `card-hover` |
| Boolean properties | `Hint Text`, `Icon Left` | `hint-text`, `icon-left` |

**Note:** Rename is INCONSISTENT across components — some still PascalCase. DS is partially migrated.

### Robustness fix:
`pickVariantFromSet` in plugin uses `norm()` function that normalizes hyphens and spaces before comparing. Handles mixed conventions automatically.

### Files updated:
- `componentPropertyMap.json` — all values match DS
- `slotGenerator.js` — lowercase variant values
- `screenRegistry.json` — kebab-case card/input states
- `plugin/code.js` — norm() matcher + render rules

---

## 7. Pending Enhancements

### From previous session (2026-03-29):
- `--patch-only` stale accumulation: repeated runs stack patches. Need reset before re-apply
- AI NL patch extra ops: AI sometimes generates more ops than requested. Needs tighter prompt

### From current session (2026-03-30):
- Auto module registry sync: `generateKnowledge.js` doesn't auto-register `slot.module.*` / `slot.content.*` pairs
- Wizard overlay popup: future DS component for rendering wizard steps inside overlay popups
- Patcher text change op: `{ "set": { "text": "..." } }` for changing TEXT node characters
- Missing input types: `comp.input.date.base`, `comp.input.number.base`, `comp.input.email.base`, `comp.input.phone.base`, `comp.input.password.base`
- `slot.overlay.form` removal from DS: pending until all overlay screens migrated

---

## 8. Workflow Preferences

- Always analyze before coding: user says "just analyze, no code change" then "yes let's make it" when ready
- Suggest the most scalable/generic approach — zero-code-change extensibility preferred
- Keep all modules default to `page.base` — only override per-screen when explicitly needed
- Don't render wizard forms in overlay popup — future feature
- Use `cardState` (not `state`) as JSON field name for SLOT_INSTRUCTION card state
- Prefer config-driven solutions over code changes
