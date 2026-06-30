const fs = require('fs');
const path = require('path');

const metaDir = process.env.META_DIR || 'Tokens/meta';
const inputFile = process.env.FIGMA_OUTPUT_FILE || path.join(metaDir, 'figma-file.json');
const componentsOutFile = path.join(metaDir, 'components.json');
const variantsOutFile = path.join(metaDir, 'variants.json');
const propertiesOutFile = path.join(metaDir, 'component-properties.json');
const iconsOutFile = path.join(metaDir, 'icons.json');
const inputPath = path.resolve(process.cwd(), inputFile);

if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing input file: ${inputFile}`);
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const components = [];
const icons = [];
const properties = [];
const variantsById = new Map();

function isIconNode(node) {
  if (!node || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) return false;
  const name = String(node.name || '').toLowerCase();
  return /\bicon\b/.test(name) || /^ic[./_-]/.test(name) || /\bico[n]?\b/.test(name);
}

function isPagePatternFrame(node) {
  if (!node || node.type !== 'FRAME') return false;
  return String(node.name || '').startsWith('page.');
}

function isSlotFrame(node) {
  if (!node || (node.type !== 'FRAME' && node.type !== 'GROUP')) return false;
  return String(node.name || '').startsWith('slot.');
}

function collectInstanceNames(node) {
  const names = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    if (current.type === 'INSTANCE' && current.name) {
      names.push(String(current.name));
    }
    if ((current.type === 'FRAME' || current.type === 'GROUP') && current !== node && String(current.name || '').startsWith('slot.')) {
      names.push(String(current.name));
    }
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return names;
}

function pickNodeMeta(node) {
  if (!node || typeof node !== 'object') return null;
  const bounds = node.absoluteBoundingBox
    ? {
        x: node.absoluteBoundingBox.x,
        y: node.absoluteBoundingBox.y,
        width: node.absoluteBoundingBox.width,
        height: node.absoluteBoundingBox.height
      }
    : null;
  return {
    type: node.type || null,
    layoutMode: node.layoutMode || null,
    itemSpacing: typeof node.itemSpacing === 'number' ? node.itemSpacing : null,
    padding: {
      left: typeof node.paddingLeft === 'number' ? node.paddingLeft : null,
      right: typeof node.paddingRight === 'number' ? node.paddingRight : null,
      top: typeof node.paddingTop === 'number' ? node.paddingTop : null,
      bottom: typeof node.paddingBottom === 'number' ? node.paddingBottom : null
    },
    primaryAxisAlignItems: node.primaryAxisAlignItems || null,
    counterAxisAlignItems: node.counterAxisAlignItems || null,
    layoutAlign: node.layoutAlign || null,
    layoutGrow: typeof node.layoutGrow === 'number' ? node.layoutGrow : null,
    constraints: node.constraints || null,
    clipsContent: typeof node.clipsContent === 'boolean' ? node.clipsContent : null,
    visible: typeof node.visible === 'boolean' ? node.visible : null,
    bounds
  };
}

function stripPropertyIdSuffix(name) {
  return String(name).replace(/\s*#\d+:\d+$/, '').trim();
}

function sanitizePropertyDefinitions(definitions) {
  const sanitized = {};

  for (const [rawName, definition] of Object.entries(definitions || {})) {
    const cleanName = stripPropertyIdSuffix(rawName);

    if (Object.prototype.hasOwnProperty.call(sanitized, cleanName)) {
      sanitized[rawName] = definition;
      continue;
    }

    sanitized[cleanName] = definition;
  }

  return sanitized;
}

function collectVariantDefinitions(definitions) {
  const variantDefs = {};

  for (const [rawName, definition] of Object.entries(definitions || {})) {
    if (!definition || definition.type !== 'VARIANT') continue;

    const cleanName = stripPropertyIdSuffix(rawName);
    variantDefs[cleanName] = {
      type: definition.type,
      defaultValue: definition.defaultValue,
      variantOptions: Array.isArray(definition.variantOptions) ? definition.variantOptions : []
    };
  }

  return variantDefs;
}

function upsertVariantEntry(id, name, variantDefs) {
  if (!variantDefs || Object.keys(variantDefs).length === 0) return;

  const current = variantsById.get(id);
  if (!current) {
    variantsById.set(id, { id, name, variants: variantDefs });
    return;
  }

  current.variants = { ...current.variants, ...variantDefs };
}

function traverse(node) {
  if (!node) return;

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || isPagePatternFrame(node) || isSlotFrame(node)) {
    const entry = {
      id: node.id,
      name: node.name,
      type: node.type,
      componentSetId: node.componentSetId || null,
      nodeMeta: pickNodeMeta(node),
      pageMeta: (isPagePatternFrame(node) || isSlotFrame(node)) ? { instances: collectInstanceNames(node) } : null
    };
    components.push(entry);
    if (isIconNode(node)) {
      icons.push(entry);
    }
  }

  if (node.variantProperties) {
    upsertVariantEntry(node.id, node.name, node.variantProperties);
  }

  if (node.componentPropertyDefinitions) {
    const sanitizedProperties = sanitizePropertyDefinitions(node.componentPropertyDefinitions);
    const variantDefinitions = collectVariantDefinitions(node.componentPropertyDefinitions);

    properties.push({
      id: node.id,
      name: node.name,
      properties: sanitizedProperties
    });

    upsertVariantEntry(node.id, node.name, variantDefinitions);
  }

  if (Array.isArray(node.children)) {
    node.children.forEach(traverse);
  }
}

traverse(data.document);

// Attach component keys from the top-level components map (separate from the document tree)
const figmaComponentsMap = data.components || {};
components.forEach(function(entry) {
  entry.key = (figmaComponentsMap[entry.id] && figmaComponentsMap[entry.id].key) || null;
});

const variants = Array.from(variantsById.values());

// Build a flat name→key lookup for downstream consumers (builders, renderers)
const keyMapData = {};
components.forEach(function(entry) {
  if (entry.name && entry.key) {
    keyMapData[entry.name] = entry.key;
  }
});
const keyMapOutFile = path.join(metaDir, 'component-key-map.json');

fs.mkdirSync(path.resolve(process.cwd(), metaDir), { recursive: true });
fs.writeFileSync(path.resolve(process.cwd(), componentsOutFile), JSON.stringify(components, null, 2));
fs.writeFileSync(path.resolve(process.cwd(), variantsOutFile), JSON.stringify(variants, null, 2));
fs.writeFileSync(path.resolve(process.cwd(), propertiesOutFile), JSON.stringify(properties, null, 2));
fs.writeFileSync(path.resolve(process.cwd(), iconsOutFile), JSON.stringify(icons, null, 2));
fs.writeFileSync(path.resolve(process.cwd(), keyMapOutFile), JSON.stringify(keyMapData, null, 2));

console.log(`Wrote ${componentsOutFile}, ${variantsOutFile}, ${propertiesOutFile}, ${iconsOutFile}, ${keyMapOutFile}`);
