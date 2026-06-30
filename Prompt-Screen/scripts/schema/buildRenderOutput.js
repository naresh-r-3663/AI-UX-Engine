// scripts/schema/buildRenderOutput.js
// Converts knowledge/schemas/generated-form-stages.schema.json → render-output.json
// Runs automatically after generate:form-schema so the plugin always has fresh data.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { resolveComponentKey } = require('../../engine/componentKeyLoader');

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function toDisplayLabel(label) {
  return String(label || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function isDropdown(componentName) {
  return String(componentName || '').includes('dropdown');
}

function buildSlotChild(schemaField, index) {
  const rawLabel = schemaField.label || schemaField.component || `Field ${index + 1}`;
  const label = toDisplayLabel(rawLabel);
  const componentName = schemaField.component || 'comp.input.text.base';
  const variantState = schemaField.state || 'Default';
  const value = schemaField.value || null;
  const placeholder = schemaField.placeholder || `Add ${label}`;
  const icon = (schemaField.leftIcon && schemaField.leftIcon.name) || 'Icon/Placeholder';
  const fieldChildComponent = isDropdown(componentName) ? 'input.dropdown.feild' : 'input.text.feild';

  return {
    type: 'INSTANCE',
    name: label,
    componentKey: resolveComponentKey(componentName),
    componentName,
    meta: {
      componentName,
      'replace.labelText': label,
      index,
      visible: true,
      'replace.inputValue': value || null,
      enabled: true,
      variantState
    },
    enabled: true,
    children: [
      {
        type: 'INSTANCE',
        name: label,
        componentKey: resolveComponentKey('input.common.label'),
        componentName: 'input.common.label',
        meta: { 'replace.labelText': label }
      },
      {
        type: 'INSTANCE',
        name: fieldChildComponent,
        componentKey: resolveComponentKey(fieldChildComponent),
        componentName: fieldChildComponent,
        meta: {
          placeholder,
          'replace.inputValue': value || null
        },
        children: [
          {
            type: 'INSTANCE',
            name: 'Icon/Placeholder',
            componentKey: resolveComponentKey('Icon/Placeholder'),
            componentName: 'Icon/Placeholder',
            meta: { icon }
          }
        ]
      },
      {
        type: 'INSTANCE',
        name: 'input.common.hint',
        componentKey: resolveComponentKey('input.common.hint'),
        componentName: 'input.common.hint',
        meta: { placeholder }
      }
    ]
  };
}

function buildSlotNode(slotChildren) {
  return {
    type: 'INSTANCE',
    name: 'slot.page.form',
    componentKey: resolveComponentKey('slot.page.form'),
    componentName: 'slot.page.form',
    children: slotChildren
  };
}

function instance(componentName) {
  return { type: 'INSTANCE', name: componentName, componentKey: resolveComponentKey(componentName), componentName };
}

function buildListFrame(title, index) {
  const prefix = String(index + 1).padStart(2, '0');
  return {
    type: 'FRAME',
    name: `${prefix} ${title} List`,
    width: 1440,
    height: 900,
    children: [
      instance('sub.pt.page.header'),
      instance('comp.primary.button'),
      instance('sub.pt.nav')
    ],
    base: 'page.list'
  };
}

function buildFormFrame(title, index, slotChildren, filled) {
  const prefix = String(index + 1).padStart(2, '0');

  // Render rule: all-Default → promote first child to Active
  if (!filled && slotChildren.length > 0) {
    slotChildren[0] = Object.assign({}, slotChildren[0], {
      meta: Object.assign({}, slotChildren[0].meta, { variantState: 'Active' })
    });
  }

  const titleEndsWithForm = /\bform\b/i.test(title);
  const frameName = filled
    ? `${prefix} Filled ${title}${titleEndsWithForm ? '' : ' Form'}`
    : `${prefix} Add ${title}`;
  return {
    type: 'FRAME',
    name: frameName,
    width: 1440,
    height: 900,
    children: [
      instance('sub.pt.page.header'),
      instance('page.form.footer'),
      buildSlotNode(slotChildren),
      instance('sub.pt.nav')
    ],
    base: 'page.form'
  };
}

function buildSuccessFrame(title, index) {
  const prefix = String(index + 1).padStart(2, '0');
  return {
    type: 'FRAME',
    name: `${prefix} ${title} Added`,
    width: 1440,
    height: 900,
    children: [
      instance('sub.pt.page.header'),
      instance('comp.primary.button'),
      instance('sub.pt.nav')
    ],
    base: 'page.success'
  };
}

function deriveTitle(schema) {
  if (schema.formIntent && schema.formIntent !== 'default form') {
    return schema.formIntent
      .replace(/[_-]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return 'Form';
}

function main() {
  const schemaPath = 'knowledge/schemas/generated-form-stages.schema.json';
  const outputPath = 'render-output.json';

  const schema = readJson(schemaPath);
  const stages = Array.isArray(schema.stages) ? schema.stages : [];

  if (stages.length === 0) {
    throw new Error('No stages found in generated-form-stages.schema.json');
  }

  // Stage 1 = empty form (Default state), Stage 3 = fully filled form
  const stage1 = stages.find((s) => s.stage === 'Stage 1') || stages[0];
  const stage3 = stages.find((s) => s.stage === 'Stage 3') || stages[stages.length - 1];

  const title = deriveTitle(schema);

  const stage1Children = (stage1.fields || [])
    .filter((f) => String(f.component || '').startsWith('comp.input.'))
    .map((f, i) => buildSlotChild(f, i));

  const stage3Children = (stage3.fields || [])
    .filter((f) => String(f.component || '').startsWith('comp.input.'))
    .map((f, i) => buildSlotChild(f, i));

  const frames = [
    buildListFrame(title, 0),
    buildFormFrame(title, 1, stage1Children, false),
    buildFormFrame(title, 2, stage3Children, true),
    buildSuccessFrame(title, 3)
  ];

  const outputFullPath = path.join(ROOT, outputPath);
  fs.writeFileSync(outputFullPath, JSON.stringify(frames, null, 2));

  console.log(`render-output.json written: ${frames.length} frames, ${stage1Children.length} slot fields`);
}

main();
