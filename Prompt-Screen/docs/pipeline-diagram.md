# Pipeline Diagram

This diagram shows how data moves through this project.

## Mermaid diagram

```mermaid
flowchart LR
    A["Figma API"] --> B["scripts/fetchFigma.js"]
    B --> C["Tokens/meta/figma-file.json"]
    C --> D["scripts/extractDesignData.js"]
    D --> E["Tokens/meta/components.json"]
    D --> F["Tokens/meta/variants.json"]
    D --> G["Tokens/meta/component-properties.json"]
    D --> H["Tokens/meta/icons.json"]

    I["Tokens/tokensv1/*.json"] --> J["scripts/generateKnowledge.js"]
    E --> J
    F --> J
    G --> J
    H --> J

    J --> K["knowledge/components/knw-components.json"]
    J --> K2["knowledge/components/knw-group-component.json"]
    J --> K3["knowledge/patterns/knw-ux-patterns.json"]
    J --> L["knowledge/components/knw-icons.json"]
    J --> M["knowledge/tokens/knw-design-tokens.json"]

    N["knowledge/ai-decisions/*.json"] --> O["scripts/schema/generateWithIconsSchema.js"]
    L --> O
    O --> P["knowledge/schemas/generated-form-stages.schema.json"]

    K --> Q["design-system-viewer.html"]
    L --> Q
    M --> Q
    U["knowledge/rules/ux-pattern-rules.json"] --> Q
    R["Tokens/tokensv1/creator.type.tokens.json"] --> Q
```

## Plain text version

```text
Figma API
  -> scripts/fetchFigma.js
  -> Tokens/meta/figma-file.json
  -> scripts/extractDesignData.js
  -> Tokens/meta/components.json
  -> Tokens/meta/variants.json
  -> Tokens/meta/component-properties.json
  -> Tokens/meta/icons.json

Tokens/tokensv1/*.json + Tokens/meta/*.json
  -> scripts/generateKnowledge.js
  -> knowledge/components/knw-components.json
  -> knowledge/components/knw-group-component.json
  -> knowledge/patterns/knw-ux-patterns.json
  -> knowledge/components/knw-icons.json
  -> knowledge/tokens/knw-design-tokens.json

knowledge/components/knw-icons.json + knowledge/ai-decisions/*.json
  -> scripts/schema/generateWithIconsSchema.js
  -> knowledge/schemas/generated-form-stages.schema.json

knowledge/{tokens,components,patterns,rules}/*.json + Tokens/tokensv1/creator.type.tokens.json
  -> design-system-viewer.html
  -> dashboard tables in browser
```
