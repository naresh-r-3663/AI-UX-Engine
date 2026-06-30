const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');
const META_DIR = process.env.META_DIR || 'Tokens/meta';
const COMPONENT_PREFIXES = ['comp.'];
const GROUP_COMPONENT_PREFIXES = ['gr.comp.', '.gr.com'];
const SUB_PATTERN_PREFIXES = ['sub.pt.'];
const PAGE_PATTERN_PREFIXES = ['page.ptn.', 'page.'];
const UX_PATTERN_PREFIXES = ['pt.'];
const SLOT_PREFIXES = ['slot.module.', 'slot.content.'];

function matchesPrefixes(name, prefixes) {
  const normalized = String(name || '').toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function isIconComponentName(name) {
  return String(name || '').toLowerCase().startsWith('icon/');
}

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readJsonOptional(relativePath, fallbackValue) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return fallbackValue;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function writeJson(relativePath, data) {
  const absolutePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2));
}

function syncOverlayHierarchy() {
  const sourcePath = path.join('knowledge', 'patterns', 'knw-overlay-hierarchy.json');
  const targetPath = path.join('knowledge', 'patterns', 'overlayHierarchy.json');
  const data = readJsonOptional(sourcePath, null);
  if (!data) {
    return { synced: false, reason: 'source missing' };
  }
  data['pt.modal.popup'] = data['pt.modal.popup'] || { parent: 'page' };
  writeJson(targetPath, data);
  return { synced: true };
}

function syncPatternExpansion() {
  const sourcePath = path.join('knowledge', 'patterns', 'knw-pattern-expansion.json');
  const targetPath = path.join('knowledge', 'patterns', 'pattern-expansion.json');
  const data = readJsonOptional(sourcePath, null);
  if (!data) {
    return { synced: false, reason: 'source missing' };
  }
  writeJson(targetPath, data);
  return { synced: true };
}

function countValueTokens(node) {
  let count = 0;
  const stack = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;

    if (!Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, '$value')) {
      count += 1;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return count;
}

function normalizeTokenGroups(rawTokens) {
  const groups = {
    primitives: {},
    alias: {},
    semantic: {}
  };
  const custom = {};

  for (const [key, value] of Object.entries(rawTokens || {})) {
    if (key === '$extensions') continue;

    const normalizedKey = key.toLowerCase().replace(/\s+/g, '');

    if (normalizedKey === 'primitive' || normalizedKey === 'primitives') {
      groups.primitives = value;
    } else if (normalizedKey === 'alias') {
      groups.alias = value;
    } else if (normalizedKey === 'semantic') {
      groups.semantic = value;
    } else {
      custom[key] = value;
    }
  }

  const normalized = {
    groups,
    stats: {
      tokenCount: countValueTokens(groups) + countValueTokens(custom)
    }
  };

  if (Object.keys(custom).length > 0) {
    normalized.groups.custom = custom;
  }

  if (rawTokens && rawTokens.$extensions) {
    normalized.extensions = rawTokens.$extensions;
  }

  return normalized;
}

function extractCategoryName(fileName) {
  const matched = fileName.match(/creator\.(.+)\.tokens\.json$/i);
  if (matched) return matched[1];
  return fileName.replace(/\.json$/i, '');
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/✦/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function findLooseNode(container, candidates) {
  if (!container || typeof container !== 'object') return null;
  const keys = Object.keys(container);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(container, candidate)) return container[candidate];
    const normalizedCandidate = normalizeKey(candidate);
    const matchedKey = keys.find((key) => normalizeKey(key) === normalizedCandidate);
    if (matchedKey) return container[matchedKey];
  }
  return null;
}

function resolveTypeTokenValue(rawTokens, node, visited = new Set()) {
  if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, '$value')) {
    return node;
  }

  const value = node.$value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) {
    return value;
  }

  const ref = value.trim();
  if (visited.has(ref)) return undefined;
  visited.add(ref);

  const refPath = ref.replace(/^\{\s*|\s*\}$/g, '').split('.').map((part) => part.trim()).filter(Boolean);

  let current = rawTokens;
  for (const part of refPath) {
    if (!current || typeof current !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
      continue;
    }
    const matchedKey = Object.keys(current).find((key) => normalizeKey(key) === normalizeKey(part));
    if (!matchedKey) return undefined;
    current = current[matchedKey];
  }

  if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, '$value')) {
    return resolveTypeTokenValue(rawTokens, current, visited);
  }

  return current;
}

function extractStyleValue(rawTypeTokens, styleNode, keys) {
  const token = findLooseNode(styleNode, keys);
  const resolved = resolveTypeTokenValue(rawTypeTokens, token);
  return resolved === undefined || resolved === null ? null : resolved;
}

function generateFontKnowledge() {
  const sourceFile = path.join('Tokens', 'tokensv1', 'creator.type.tokens.json');
  const rawTypeTokens = readJson(sourceFile);
  const semanticNode = findLooseNode(rawTypeTokens, ['Semantic']);
  const typeDefaultNode = findLooseNode(semanticNode, ['Type Default', 'Type Default ✦']);
  const styleNames = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

  const styles = styleNames.map((styleName) => {
    const styleNode = findLooseNode(typeDefaultNode, [styleName]) || {};
    return {
      style: styleName,
      family: extractStyleValue(rawTypeTokens, styleNode, ['family', 'font-family']),
      size: extractStyleValue(rawTypeTokens, styleNode, ['size', 'font-size']),
      lineHeight: extractStyleValue(rawTypeTokens, styleNode, ['lineheight', 'line-height']),
      weightRegular: extractStyleValue(rawTypeTokens, styleNode, [
        'weight-regular',
        'weight-regular ✦',
        'weight-regular  ✦',
        'font-weight-regular',
        'font-weight-regular ✦'
      ]),
      weightSemibold: extractStyleValue(rawTypeTokens, styleNode, ['weight-semibold', 'font-weight-semibold']),
      weightBold: extractStyleValue(rawTypeTokens, styleNode, ['weight-bold', 'font-weight-bold'])
    };
  });

  const p2Style = styles.find((item) => item.style === 'P2');
  const payload = {
    schema: 'knowledge/font/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      sourceFile,
      styleCount: styles.length,
      baseStyle: 'P2',
      baseSize: p2Style && typeof p2Style.size === 'number' ? p2Style.size : null
    },
    styles
  };

  writeJson(path.join('knowledge', 'tokens', 'knw-font.json'), payload);
  return payload.summary;
}

function generateDesignTokensKnowledge() {
  const tokensDir = path.join(ROOT, 'Tokens', 'tokensv1');
  if (!fs.existsSync(tokensDir)) {
    throw new Error('Missing required folder: Tokens/tokensv1');
  }

  const tokenFiles = fs
    .readdirSync(tokensDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  const categories = {};

  for (const fileName of tokenFiles) {
    const relativePath = path.join('Tokens', 'tokensv1', fileName);
    const rawTokens = readJson(relativePath);
    const category = extractCategoryName(fileName);

    categories[category] = {
      sourceFile: relativePath,
      ...normalizeTokenGroups(rawTokens)
    };
  }

  const payload = {
    schema: 'knowledge/design-tokens/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      categoryCount: Object.keys(categories).length,
      categories: Object.keys(categories)
    },
    categories
  };

  writeJson(path.join('knowledge', 'tokens', 'knw-design-tokens.json'), payload);
  return payload.summary;
}

function buildComponentIndex() {
  const components = readJson(path.join(META_DIR, 'components.json'));
  const variants = readJson(path.join(META_DIR, 'variants.json'));
  const componentProperties = readJson(path.join(META_DIR, 'component-properties.json'));

  const variantsById = new Map(variants.map((item) => [item.id, item]));
  const variantsByName = new Map(variants.map((item) => [item.name, item]));
  const propertiesById = new Map(componentProperties.map((item) => [item.id, item]));
  const propertiesByName = new Map(componentProperties.map((item) => [item.name, item]));

  const enrichedComponents = components.map((component) => {
    const matchedVariant = variantsById.get(component.id) || variantsByName.get(component.name);
    const matchedProperty = propertiesById.get(component.id) || propertiesByName.get(component.name);

    const mergedVariants = matchedVariant && matchedVariant.variants ? matchedVariant.variants : {};
    const mergedProperties = matchedProperty && matchedProperty.properties ? matchedProperty.properties : {};

    return {
      id: component.id,
      name: component.name,
      type: component.type,
      key: component.key || null,
      variants: mergedVariants,
      properties: mergedProperties,
      nodeMeta: component.nodeMeta || null,
      pageMeta: component.pageMeta || null,
      meta: {
        hasVariants: Object.keys(mergedVariants).length > 0,
        hasProperties: Object.keys(mergedProperties).length > 0
      }
    };
  });

  return { enrichedComponents, variantsById, variantsByName, propertiesById, propertiesByName };
}

function filterComponentsByPrefixes(enrichedComponents, prefixes) {
  const allowedSets = enrichedComponents.filter(
    (component) => component.type === 'COMPONENT_SET' && matchesPrefixes(component.name, prefixes)
  );
  const allowedSetIds = new Set(allowedSets.map((component) => component.id));
  const allowedVariantKeys = new Set(
    allowedSets.flatMap((component) => Object.keys(component.variants || {})).map((key) => key.toLowerCase())
  );

  function isVariantOfAllowedSetByName(component) {
    if (!component || component.type !== 'COMPONENT') return false;
    const name = String(component.name || '');
    if (!name.includes('=')) return false;
    const normalized = name.toLowerCase();
    for (const key of allowedVariantKeys) {
      if (normalized.includes(`${key.toLowerCase()}=`)) return true;
    }
    return false;
  }

  const governanceCandidates = enrichedComponents.filter((component) => !isIconComponentName(component.name));

  const allowedComponents = governanceCandidates.filter((component) => {
    if (matchesPrefixes(component.name, prefixes)) return true;
    if (component.type === 'COMPONENT' && component.componentSetId && allowedSetIds.has(component.componentSetId)) {
      return true;
    }
    if (isVariantOfAllowedSetByName(component)) return true;
    return false;
  });

  return { governanceCandidates, allowedComponents };
}

function generateComponentsKnowledge(enrichedComponents) {
  const { governanceCandidates, allowedComponents } = filterComponentsByPrefixes(enrichedComponents, COMPONENT_PREFIXES);
  const { allowedComponents: groupComponents } = filterComponentsByPrefixes(
    enrichedComponents,
    GROUP_COMPONENT_PREFIXES
  );
  const disallowedComponents = governanceCandidates.filter(
    (component) => !allowedComponents.includes(component) && !groupComponents.includes(component)
  );

  const leakedGroupComponents = allowedComponents.filter((component) =>
    GROUP_COMPONENT_PREFIXES.some((prefix) => component.name?.startsWith(prefix))
  );
  if (leakedGroupComponents.length) {
    const sample = leakedGroupComponents
      .slice(0, 5)
      .map((component) => component.name)
      .join(', ');
    console.warn(
      `Warning: group components leaked into knw-components.json (count: ${leakedGroupComponents.length}). Sample: ${sample}`
    );
  }

  const withVariants = allowedComponents.filter((component) => component.meta.hasVariants).length;
  const withProperties = allowedComponents.filter((component) => component.meta.hasProperties).length;

  const payload = {
    schema: 'knowledge/components/v1',
    generatedAt: new Date().toISOString(),
    policy: {
      allowedPrefixes: COMPONENT_PREFIXES,
      iconPrefixExcludedFromDisallowed: 'icon/*',
      includeVariantsFromAllowedComponentSets: true,
      variantMatchingFallback: 'name-pattern by allowed variant keys (key=...)'
    },
    summary: {
      totalComponents: allowedComponents.length,
      totalRawComponents: governanceCandidates.length,
      excludedIcons: enrichedComponents.length - governanceCandidates.length,
      disallowedCount: disallowedComponents.length,
      withVariants,
      withProperties
    },
    components: allowedComponents,
    disallowedComponents
  };

  writeJson(path.join('knowledge', 'components', 'knw-components.json'), payload);
  return payload.summary;
}

function generateGroupComponentsKnowledge(enrichedComponents) {
  const { allowedComponents } = filterComponentsByPrefixes(enrichedComponents, GROUP_COMPONENT_PREFIXES);
  const withVariants = allowedComponents.filter((component) => component.meta.hasVariants).length;
  const withProperties = allowedComponents.filter((component) => component.meta.hasProperties).length;

  const payload = {
    schema: 'knowledge/group-components/v1',
    generatedAt: new Date().toISOString(),
    policy: {
      allowedPrefixes: GROUP_COMPONENT_PREFIXES,
      iconPrefixExcludedFromDisallowed: 'icon/*',
      includeVariantsFromAllowedComponentSets: true,
      variantMatchingFallback: 'name-pattern by allowed variant keys (key=...)'
    },
    summary: {
      totalGroupComponents: allowedComponents.length,
      withVariants,
      withProperties
    },
    groupComponents: allowedComponents
  };

  writeJson(path.join('knowledge', 'components', 'knw-group-component.json'), payload);
  return payload.summary;
}
function generateSubPatternsKnowledge(enrichedComponents) {
  const { allowedComponents } = filterComponentsByPrefixes(enrichedComponents, SUB_PATTERN_PREFIXES);
  const withVariants = allowedComponents.filter((component) => component.meta.hasVariants).length;
  const withProperties = allowedComponents.filter((component) => component.meta.hasProperties).length;

  const payload = {
    schema: 'knowledge/sub-patterns/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalSubPatterns: allowedComponents.length,
      withVariants,
      withProperties
    },
    subPatterns: allowedComponents
  };

  writeJson(path.join('knowledge', 'patterns', 'knw-sub-patterns.json'), payload);
  return payload.summary;
}

function generatePagePatternsKnowledge(enrichedComponents) {
  const { allowedComponents } = filterComponentsByPrefixes(enrichedComponents, PAGE_PATTERN_PREFIXES);
  const withVariants = allowedComponents.filter((component) => component.meta.hasVariants).length;
  const withProperties = allowedComponents.filter((component) => component.meta.hasProperties).length;

  const pagePatterns = allowedComponents.map((component) => {
    const maxWidth = component.nodeMeta?.bounds?.width || 1440;
    return {
      ...component,
      layout: component.pageMeta?.layout || 'vertical',
      grid: component.pageMeta?.grid || { columns: 12, maxWidth },
      sections: component.pageMeta?.sections || [],
      components: component.pageMeta?.instances || []
    };
  });

  const payload = {
    schema: 'knowledge/page-patterns/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalPagePatterns: allowedComponents.length,
      withVariants,
      withProperties
    },
    pagePatterns
  };

  writeJson(path.join('knowledge', 'patterns', 'knw-page-patterns.json'), payload);
  return payload.summary;
}

function generateSlotsKnowledge(enrichedComponents) {
  const { allowedComponents } = filterComponentsByPrefixes(enrichedComponents, SLOT_PREFIXES);
  const withInstances = allowedComponents.filter((c) => (c.pageMeta?.instances || []).length > 0).length;

  const slots = allowedComponents.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.name.startsWith('slot.module.') ? 'module' : 'content',
    instances: c.pageMeta?.instances || [],
    nodeMeta: c.nodeMeta || null
  }));

  const payload = {
    schema: 'knowledge/slots/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalSlots: slots.length,
      moduleSlots: slots.filter((s) => s.type === 'module').length,
      contentSlots: slots.filter((s) => s.type === 'content').length,
      withInstances
    },
    slots
  };

  writeJson(path.join('knowledge', 'slots', 'knw-slots.json'), payload);
  return payload.summary;
}

function generateUxPatternsKnowledge(enrichedComponents) {
  const { allowedComponents } = filterComponentsByPrefixes(enrichedComponents, UX_PATTERN_PREFIXES);
  const withVariants = allowedComponents.filter((component) => component.meta.hasVariants).length;
  const withProperties = allowedComponents.filter((component) => component.meta.hasProperties).length;

  const payload = {
    schema: 'knowledge/ux-patterns/v1',
    generatedAt: new Date().toISOString(),
    policy: {
      allowedPrefixes: UX_PATTERN_PREFIXES
    },
    summary: {
      totalUxPatterns: allowedComponents.length,
      withVariants,
      withProperties
    },
    rulesFile: 'knowledge/rules/ux-pattern-rules.json',
    uxRules: [],
    stateRules: [],
    uxPatterns: allowedComponents
  };

  writeJson(path.join('knowledge', 'patterns', 'knw-ux-patterns.json'), payload);
  return payload.summary;
}

function generateIconsKnowledge() {
  const aliasDictionary = {
    add: ['plus', 'create', 'new', 'insert'],
    alert: ['warning', 'caution', 'attention'],
    arrow: ['chevron', 'caret', 'direction'],
    bento: ['grid', 'menu', 'apps'],
    close: ['dismiss', 'cancel', 'x'],
    clock: ['time', 'history', 'recent'],
    connection: ['link', 'integrate', 'network'],
    delete: ['remove', 'trash', 'bin', 'clear'],
    dots: ['more', 'overflow', 'kebab', 'ellipsis'],
    edit: ['update', 'modify', 'pencil', 'rename'],
    environment: ['layer', 'stack', 'context'],
    error: ['fail', 'invalid', 'danger'],
    filter: ['funnel', 'refine', 'sort'],
    folder: ['directory', 'files', 'collection'],
    hint: ['help', 'tip', 'assist'],
    info: ['information', 'details', 'about'],
    metrics: ['analytics', 'stats', 'kpi'],
    minus: ['subtract', 'remove', 'collapse'],
    money: ['payment', 'pay', 'amount', 'price', 'cost', 'fee', 'billing', 'card', 'cvv', 'expiry', 'expiration', 'currency', 'finance', 'transaction', 'invoice', 'charge'],
    more: ['overflow', 'menu', 'options'],
    organization: ['org', 'company', 'workspace'],
    placeholder: ['default', 'empty', 'fallback'],
    plus: ['add', 'create', 'new', 'insert'],
    search: ['find', 'lookup', 'query'],
    settings: ['preferences', 'config', 'options'],
    success: ['check', 'done', 'complete'],
    tick: ['check', 'done', 'approve'],
    users: ['people', 'members', 'team', 'patient', 'visitor']
  };

  function tokenizeIconName(name) {
    const cleaned = String(name || '')
      .replace(/^icon\//i, '')
      .replace(/[()]/g, ' ')
      .replace(/[_./-]/g, ' ')
      .toLowerCase();
    return cleaned
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
  }

  function buildAliases(name) {
    const tokens = tokenizeIconName(name);
    const aliases = new Set(tokens);

    for (const token of tokens) {
      const mapped = aliasDictionary[token];
      if (mapped) {
        mapped.forEach((syn) => aliases.add(syn));
      }
    }

    return Array.from(aliases);
  }

  const icons = readJsonOptional(path.join(META_DIR, 'icons.json'), []);
  const variants = readJson(path.join(META_DIR, 'variants.json'));
  const componentProperties = readJson(path.join(META_DIR, 'component-properties.json'));

  const variantsById = new Map(variants.map((item) => [item.id, item]));
  const variantsByName = new Map(variants.map((item) => [item.name, item]));
  const propertiesById = new Map(componentProperties.map((item) => [item.id, item]));
  const propertiesByName = new Map(componentProperties.map((item) => [item.name, item]));

  const enrichedIcons = icons.map((icon) => {
    const matchedVariant = variantsById.get(icon.id) || variantsByName.get(icon.name);
    const matchedProperty = propertiesById.get(icon.id) || propertiesByName.get(icon.name);

    const mergedVariants = matchedVariant && matchedVariant.variants ? matchedVariant.variants : {};
    const mergedProperties = matchedProperty && matchedProperty.properties ? matchedProperty.properties : {};

    return {
      id: icon.id,
      name: icon.name,
      type: icon.type,
      aliases: buildAliases(icon.name),
      variants: mergedVariants,
      properties: mergedProperties,
      meta: {
        hasVariants: Object.keys(mergedVariants).length > 0,
        hasProperties: Object.keys(mergedProperties).length > 0
      }
    };
  });

  const withVariants = enrichedIcons.filter((icon) => icon.meta.hasVariants).length;
  const withProperties = enrichedIcons.filter((icon) => icon.meta.hasProperties).length;

  const payload = {
    schema: 'knowledge/icons/v1',
    generatedAt: new Date().toISOString(),
    summary: {
      totalIcons: enrichedIcons.length,
      withVariants,
      withProperties
    },
    icons: enrichedIcons
  };

  writeJson(path.join('knowledge', 'components', 'knw-icons.json'), payload);
  return payload.summary;
}

// Auto-register any slot.overlay.* components found during sync into screenRegistry.json.
// Only adds missing entries — never overwrites or removes existing ones.
// e.g. slot.overlay.form → "overlay form": { "overlaySlot": "slot.overlay.form" }
function syncOverlaySlotRegistry(enrichedComponents) {
  const REGISTRY_PATH = path.join(ROOT, 'config', 'screenRegistry.json');
  if (!fs.existsSync(REGISTRY_PATH)) return { added: [] };

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const added = [];

  const overlayComponents = enrichedComponents.filter(
    (c) => typeof c.name === 'string' && c.name.startsWith('slot.overlay.')
  );

  for (const comp of overlayComponents) {
    const suffix     = comp.name.slice('slot.overlay.'.length)   // e.g. "form", "delete"
    const screenKey  = 'overlay ' + suffix.replace(/[._]/g, ' ') // e.g. "overlay form"
    const exists     = Object.keys(registry).some(
      (k) => k.toLowerCase() === screenKey.toLowerCase()
    );
    if (!exists) {
      registry[screenKey] = {
        overlaySlot: comp.name,
        ...(comp.type === "FRAME" ? { overlayCompose: true } : {})
      };
      added.push(screenKey);
    }
  }

  if (added.length > 0) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  }

  return { added };
}

// Auto-sync componentPropertyMap.json from DS component variants/properties.
// Preserves existing semantic/hoverValue annotations; auto-detects hover for new entries.
function syncComponentPropertyMap(enrichedComponents) {
  const MAP_PATH = path.join(ROOT, 'config', 'componentPropertyMap.json');
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')); } catch (_) {}

  const updated = {};
  const COMP_PREFIXES = ['comp.input.', 'comp.primary.', 'comp.secondary.', 'comp.huegrey.', 'comp.error.', 'comp.disabled.'];

  const componentSets = enrichedComponents.filter(function(c) {
    return c.type === 'COMPONENT_SET' && typeof c.name === 'string' &&
      COMP_PREFIXES.some(function(p) { return c.name.startsWith(p); });
  });

  for (const comp of componentSets) {
    const name = comp.name;
    const props = comp.properties || {};
    const entry = {};
    const existingEntry = existing[name] || {};

    for (const propName of Object.keys(props)) {
      const prop = props[propName];
      if (!prop || !prop.type) continue;

      const existingProp = existingEntry[propName] || {};

      if (prop.type === 'VARIANT') {
        const values = prop.variantOptions || [];
        const built = {
          type: 'VARIANT',
          defaultValue: prop.defaultValue || (values[0] || 'default'),
          values: values
        };
        // Preserve or auto-detect semantic hover
        if (existingProp.semantic) {
          built.semantic = existingProp.semantic;
          built.hoverValue = existingProp.hoverValue;
        } else {
          // Auto-detect: property named "hover" with true/false values
          const propLower = propName.toLowerCase();
          if (propLower === 'hover') {
            built.semantic = 'hover';
            built.hoverValue = values.find(function(v) { return v.toLowerCase() === 'true'; }) || values[1] || 'true';
          }
          // Auto-detect: property named "state" with hover-on-default value
          if (propLower === 'state') {
            const hoverVal = values.find(function(v) { return v.toLowerCase().indexOf('hover') !== -1; });
            if (hoverVal) {
              built.semantic = 'hover';
              built.hoverValue = hoverVal;
            }
          }
        }
        entry[propName] = built;
      } else if (prop.type === 'BOOLEAN') {
        entry[propName] = {
          type: 'BOOLEAN',
          defaultValue: prop.defaultValue !== undefined ? prop.defaultValue : false
        };
      } else if (prop.type === 'INSTANCE_SWAP') {
        entry[propName] = {
          type: 'INSTANCE_SWAP',
          defaultValue: prop.defaultValue || null
        };
      }
    }

    if (Object.keys(entry).length > 0) {
      updated[name] = entry;
    }
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(updated, null, 2));

  return {
    total: Object.keys(updated).length,
    components: Object.keys(updated)
  };
}

function main() {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const tokenSummary = generateDesignTokensKnowledge();
  const fontSummary = generateFontKnowledge();
  const { enrichedComponents } = buildComponentIndex();
  const componentSummary = generateComponentsKnowledge(enrichedComponents);
  const groupComponentSummary = generateGroupComponentsKnowledge(enrichedComponents);
  const subPatternSummary = generateSubPatternsKnowledge(enrichedComponents);
  const pagePatternSummary = generatePagePatternsKnowledge(enrichedComponents);
  const uxPatternSummary = generateUxPatternsKnowledge(enrichedComponents);
  const slotSummary = generateSlotsKnowledge(enrichedComponents);
  const iconSummary = generateIconsKnowledge();
  const overlaySync = syncOverlayHierarchy();
  const expansionSync = syncPatternExpansion();
  const overlayRegistry = syncOverlaySlotRegistry(enrichedComponents);
  const propertyMapSync = syncComponentPropertyMap(enrichedComponents);

  console.log('Knowledge files updated:');
  console.log('- knowledge/tokens/knw-design-tokens.json', tokenSummary);
  console.log('- knowledge/tokens/knw-font.json', fontSummary);
  console.log('- knowledge/components/knw-components.json', componentSummary);
  console.log('- knowledge/components/knw-group-component.json', groupComponentSummary);
  console.log('- knowledge/patterns/knw-sub-patterns.json', subPatternSummary);
  console.log('- knowledge/patterns/knw-page-patterns.json', pagePatternSummary);
  console.log('- knowledge/patterns/knw-ux-patterns.json', uxPatternSummary);
  console.log('- knowledge/slots/knw-slots.json', slotSummary);
  console.log('- knowledge/components/knw-icons.json', iconSummary);
  if (overlaySync.synced) {
    console.log('- knowledge/patterns/overlayHierarchy.json synced');
  }
  if (expansionSync.synced) {
    console.log('- knowledge/patterns/pattern-expansion.json synced');
  }
  if (overlayRegistry.added.length > 0) {
    console.log('- config/screenRegistry.json auto-added overlay slots:', overlayRegistry.added.join(', '));
  }
  console.log('- config/componentPropertyMap.json synced:', propertyMapSync.total, 'components');
}

main();
