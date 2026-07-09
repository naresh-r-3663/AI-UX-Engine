# JSON to Editable Figma Plugin

This plugin imports a JSON tree and recreates it as editable Figma layers.

## Setup

```bash
npm install
npm run build
```

In Figma Desktop:
1. `Plugins` -> `Development` -> `Import plugin from manifest...`
2. Select this folder's `manifest.json`
3. Run the plugin and paste your JSON

## Supported input patterns

Top-level JSON can be:
- an array of nodes
- `{ "children": [...] }`
- `{ "nodes": [...] }`
- `{ "document": { "children": [...] } }`
- a single node object with `type`
- `{ "schema": "generated/form-stages/v2", "stages": [...] }` (auto-built editable form layout)

## Design system binding

For direct DS components (instead of fallback frames), set mappings in [code.ts](/Users/saravanan-4874/Documents/figma json/code.ts):
- `COMPONENT_KEY_BY_ALIAS`: map `comp.*` aliases to published Figma component keys (recommended)
- `LOCAL_COMPONENT_NAME_BY_ALIAS`: optional local component/component-set names in current file

Resolution order is:
1. `componentKey` from JSON (if provided)
2. `COMPONENT_KEY_BY_ALIAS`
3. local component/component set by mapped name
4. fallback frame rendering

Node keys supported (when present):
- `type`, `name`, `x`, `y`, `width`, `height`, `rotation`, `opacity`
- `fills`, `strokes`, `strokeWeight`, `cornerRadius`
- `layoutMode`, align/sizing/padding fields for auto layout
- text fields: `characters` or `text`, `fontName` or (`fontFamily` + `fontStyle`), `fontSize`, `lineHeight`

## Example JSON

```json
{
  "type": "FRAME",
  "name": "Card",
  "width": 320,
  "height": 180,
  "fills": [{ "type": "SOLID", "color": "#F3F4F6" }],
  "children": [
    {
      "type": "TEXT",
      "name": "Title",
      "x": 16,
      "y": 20,
      "characters": "Hello from JSON",
      "fontSize": 24,
      "fills": [{ "type": "SOLID", "color": "#111827" }]
    },
    {
      "type": "RECTANGLE",
      "name": "CTA",
      "x": 16,
      "y": 110,
      "width": 120,
      "height": 44,
      "cornerRadius": 8,
      "fills": ["#2563EB"]
    }
  ]
}
```
