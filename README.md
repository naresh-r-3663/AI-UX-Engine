# Figma Export V1 - Design System Knowledge Engine

This project converts design data into a reusable knowledge base.

It is built to help teams:
- pull component and token data from Figma,
- normalize and clean that data,
- generate structured JSON for downstream AI/workflow usage,
- view everything in a human-friendly dashboard.

## What this project does

Input:
- Figma file data
- design tokens (`Tokens/tokensv1/*.json`)
- decision rules (`knowledge/ai-decisions/*.json`)
- UX pattern rules (`knowledge/rules/ux-pattern-rules.json`)

Output:
- knowledge JSON files for components, icons, tokens, and font styles
- generated staged form schema with icon + label decisions
- browser viewer for easy inspection

## Architecture diagram (text)

```text
Figma API
  |
  | scripts/fetchFigma.js
  v
Tokens/meta/figma-file.json
  |
  | scripts/extractDesignData.js
  +--> Tokens/meta/components.json
  +--> Tokens/meta/variants.json
  +--> Tokens/meta/component-properties.json
  +--> Tokens/meta/icons.json

Tokens/meta/*.json + Tokens/tokensv1/*.json
  |
  | scripts/generateKnowledge.js
  v
knowledge/components/knw-components.json
knowledge/components/knw-group-component.json
knowledge/components/knw-icons.json
knowledge/tokens/knw-design-tokens.json
knowledge/tokens/knw-font.json
knowledge/patterns/knw-ux-patterns.json

knowledge/components/knw-icons.json + knowledge/ai-decisions/*.json
  |
  | scripts/schema/generateWithIconsSchema.js
  v
knowledge/schemas/generated-form-stages.schema.json

knowledge/{tokens,components,patterns,rules}/*.json
  |
  | design-system-viewer.html
  v
Human-readable dashboard in browser
```

Detailed diagram: [docs/pipeline-diagram.md](docs/pipeline-diagram.md)

## Folder guide

| Path | Contains | Purpose |
|---|---|---|
| `scripts/` | Main Node.js pipeline scripts | Fetch, extract, and generate knowledge files |
| `scripts/schema/` | Schema generation logic | Creates staged form schema with icon/label decisions |
| `Tokens/meta/` | Raw and extracted Figma JSON | Intermediate pipeline data |
| `Tokens/tokensv1/` | Raw design token files | Source tokens (color/type/radius/elevation) |
| `knowledge/` | Final knowledge outputs | Main data used by viewer and schema generators |
| `knowledge/tokens/` | Token knowledge outputs | Design tokens + font data |
| `knowledge/components/` | Component knowledge outputs | Components + icons data |
| `knowledge/patterns/` | Pattern knowledge outputs | Sub-, page-, and UX patterns |
| `knowledge/rules/` | Rules knowledge outputs | Decision engine inputs |
| `knowledge/ai-decisions/` | Policy + matching rules | Controls icon selection and action labels |
| `knowledge/schemas/` | Generated schema outputs | Final generated form-stage schema |
| `design-system-viewer.html` | Standalone UI page | Visual dashboard for the knowledge base |
| `student-registration.html` | Example token-driven form page | Demonstrates practical UI usage |
| `debug cehck/` | Snapshot/debug files | Reference data, not core runtime |

## Main working logic

| Step | Script | Input | Output | Why |
|---|---|---|---|---|
| 1 | `scripts/fetchFigma.js` | `.env` (`FIGMA_TOKEN`, `FIGMA_FILE_KEY`) | `Tokens/meta/figma-file.json` | Downloads Figma file JSON |
| 2 | `scripts/extractDesignData.js` | `Tokens/meta/figma-file.json` | `Tokens/meta/components.json`, `Tokens/meta/variants.json`, `Tokens/meta/component-properties.json`, `Tokens/meta/icons.json` | Extracts component-level datasets |
| 3 | `scripts/generateKnowledge.js` | `Tokens/meta/*` + `Tokens/tokensv1/*` | `knowledge/components/knw-components.json`, `knowledge/components/knw-group-component.json`, `knowledge/components/knw-icons.json`, `knowledge/tokens/knw-design-tokens.json`, `knowledge/tokens/knw-font.json`, `knowledge/patterns/knw-ux-patterns.json` | Produces normalized knowledge files |
| 4 | `scripts/schema/generateWithIconsSchema.js` | `knowledge/components/knw-icons.json` + `knowledge/ai-decisions/*` | `knowledge/schemas/generated-form-stages.schema.json` | Generates staged form schema with confidence + candidates |
| 5 | `design-system-viewer.html` | `knowledge/{tokens,components,patterns,rules}/*` (fallback: raw type tokens) | Rendered browser tables | Makes data understandable for humans |

## NPM commands

From `package.json`:

- `npm run fetch:figma` - fetch Figma file JSON
- `npm run extract:figma` - extract components/variants/properties/icons from meta file
- `npm run generate:knowledge` - generate `knw-*` files
- `npm run generate:form-schema` - generate staged form schema with icon rules
- `npm run refresh:knowledge` - extract + generate knowledge
- `npm run sync:knowledge` - fetch (unless `SKIP_FETCH=1`) + extract + generate knowledge

Student Registration test form preset (Stage 3, fixed icons + dropdown components):

```bash
node scripts/schema/generateWithIconsSchema.js \
  --test-form student-registration-stage3 \
  --output knowledge/schemas/student-registration-stage3.schema.json
```

## Environment variables

Use `.env` (see `.env.example`):

- `FIGMA_TOKEN` - Figma personal access token
- `FIGMA_FILE_KEY` - target Figma file key
- `FIGMA_OUTPUT_FILE` (optional) - output path for raw Figma JSON
- `META_DIR` (optional) - meta directory override
- `SKIP_FETCH=1` (optional) - skip Figma API fetch in sync flow

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
# fill FIGMA_TOKEN and FIGMA_FILE_KEY
```

3. Run full sync:

```bash
npm run sync:knowledge
```

4. Generate form schema (optional):

```bash
npm run generate:form-schema
```

5. Open viewer via local server (not `file://`):

Example:

```bash
npx serve .
```

Then open the local URL and view `design-system-viewer.html`.

## Non-technical one-line explanation

This repository turns Figma and design tokens into a structured, reusable knowledge system that can be viewed by humans and consumed by automation.
