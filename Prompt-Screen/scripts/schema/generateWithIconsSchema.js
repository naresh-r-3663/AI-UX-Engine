const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function readJsonOptional(relativePath, fallbackValue) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallbackValue;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function isTextareaField(label) {
  const normalized = normalizeWord(label);
  return ['message', 'comments', 'description', 'notes', 'feedback'].some((keyword) =>
    normalized.includes(keyword)
  );
}

function pickInputComponent(label) {
  return isTextareaField(label) ? 'comp.input.textarea.base' : 'comp.input.text.base';
}

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDisplayLabel(label) {
  return String(label || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function derivePlaceholder(label) {
  const normalized = normalizeWord(label);
  if (normalized.includes('date')) return 'Add date';
  if (normalized.includes('email')) return 'Enter email';
  if (normalized.includes('phone') || normalized.includes('mobile')) return 'Enter phone number';
  if (normalized.includes('name')) return 'Enter name';
  if (normalized.includes('id')) return 'Enter ID';
  if (normalized.includes('quantity')) return 'Enter quantity';
  if (normalized.includes('message') || normalized.includes('comment') || normalized.includes('description') || normalized.includes('reason')) {
    return 'Enter details';
  }
  return `Enter ${toDisplayLabel(label).toLowerCase()}`;
}

function deriveSampleValue(label) {
  const normalized = normalizeWord(label);
  if (normalized.includes('date')) return '2026-03-25';
  if (normalized.includes('email')) return 'user@company.com';
  if (normalized.includes('phone') || normalized.includes('mobile')) return '+1 555 010 2244';
  if (normalized.includes('name')) return 'Alex Johnson';
  if (normalized.includes('id')) return 'EMP-2045';
  if (normalized.includes('quantity')) return '1';
  if (normalized.includes('message') || normalized.includes('comment') || normalized.includes('description') || normalized.includes('reason')) {
    return 'Need this for day-to-day project work.';
  }
  return 'Sample value';
}

function defaultIconLexicon() {
  return {
    name: ['user', 'person', 'profile', 'users', 'identity', 'account'],
    email: ['mail', 'contact', 'info', 'message'],
    phone: ['mobile', 'call', 'contact', 'connection'],
    message: ['comment', 'note', 'edit', 'text', 'feedback'],
    comments: ['comment', 'message', 'note', 'edit'],
    description: ['message', 'note', 'text', 'edit', 'info'],
    feedback: ['message', 'comment', 'note', 'edit'],
    organization: ['company', 'workspace', 'org', 'team'],
    submit: ['success', 'tick', 'check', 'done', 'arrow'],
    cancel: ['close', 'error', 'minus'],
    save: ['success', 'tick', 'check', 'done']
  };
}

function buildIntentTokens(inputText, lexicon) {
  const baseTokens = tokenize(inputText);
  const expanded = new Set(baseTokens);

  for (const token of baseTokens) {
    const related = lexicon[token];
    if (!related) continue;
    related.forEach((alias) => expanded.add(alias));
  }

  return Array.from(expanded);
}

function getSlotBoost(slot, iconRules) {
  const slotRules = iconRules?.slotBoost?.[slot];
  return {
    preferred: new Set(Array.isArray(slotRules?.preferred) ? slotRules.preferred.map(normalizeWord) : []),
    blocked: new Set(Array.isArray(slotRules?.blocked) ? slotRules.blocked.map(normalizeWord) : [])
  };
}

function rankIconsForIntent(intentText, slot, icons, iconRules) {
  const lexicon = iconRules?.intentLexicon || defaultIconLexicon();
  const intentTokens = buildIntentTokens(intentText, lexicon);
  const slotBoost = getSlotBoost(slot, iconRules);
  const scored = [];

  for (const icon of icons) {
    const iconTokens = new Set(
      [
        ...tokenize(icon.name.replace(/^icon\//i, '')),
        ...(Array.isArray(icon.aliases) ? icon.aliases.map((item) => normalizeWord(item)) : [])
      ].filter(Boolean)
    );

    const matched = intentTokens.filter((token) => iconTokens.has(token));
    let score = matched.length;

    for (const token of iconTokens) {
      if (slotBoost.preferred.has(token)) score += 0.25;
      if (slotBoost.blocked.has(token)) score -= 0.75;
    }

    scored.push({
      iconName: icon.name,
      score,
      matchedAliases: matched
    });
  }

  scored.sort((a, b) => b.score - a.score || a.iconName.localeCompare(b.iconName));
  return scored;
}

function pickConfidence(score, policy) {
  const high = Number(policy?.confidenceThresholds?.high ?? 2);
  const medium = Number(policy?.confidenceThresholds?.medium ?? 1);
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}

function chooseIconForIntent(intentText, slot, icons, candidateLimit, iconRules, policy) {
  const scored = rankIconsForIntent(intentText, slot, icons, iconRules);
  const matchedCandidates = scored.filter((item) => item.score > 0);

  if (matchedCandidates.length > 0) {
    const best = matchedCandidates[0];
    const candidates = matchedCandidates.slice(0, candidateLimit).map((item) => ({
      icon: item.iconName,
      score: Number(item.score.toFixed(2)),
      matchedAliases: item.matchedAliases,
      reason: `Matched aliases: ${item.matchedAliases.join(', ')}`
    }));
    return {
      icon: best.iconName,
      confidence: pickConfidence(best.score, policy),
      reason: `Matched aliases: ${best.matchedAliases.join(', ')}`,
      candidates
    };
  }

  const placeholder = icons.find((icon) => normalizeWord(icon.name) === 'icon/placeholder');
  const fallbackName = policy?.fallback?.icon || 'Icon/Placeholder';
  if (placeholder) {
    return {
      icon: placeholder.name,
      confidence: 'low',
      reason: 'No alias match found; fallback to Icon/Placeholder',
      candidates: [
        {
          icon: placeholder.name,
          score: 0,
          matchedAliases: [],
          reason: 'Fallback candidate'
        }
      ]
    };
  }

  return {
    icon: icons[0] ? icons[0].name : fallbackName,
    confidence: 'low',
    reason: 'No alias match found; fallback to first available icon',
    candidates: [
      {
        icon: icons[0] ? icons[0].name : fallbackName,
        score: 0,
        matchedAliases: [],
        reason: 'Fallback candidate'
      }
    ]
  };
}

function resolveActionLabels(formIntent, labelRules, policy) {
  const normalizedIntent = normalizeWord(formIntent);
  const mappings = Array.isArray(labelRules?.intentMap) ? labelRules.intentMap : [];
  const defaults = labelRules?.defaults || {};

  const matched = mappings.find((entry) => {
    const terms = Array.isArray(entry.match) ? entry.match : [];
    return terms.some((term) => normalizedIntent.includes(normalizeWord(term)));
  });

  if (matched) {
    return {
      primary: {
        text: matched.primary || defaults.primary || policy?.fallback?.primaryLabel || 'Submit',
        confidence: 'high',
        reason: `Matched form intent: ${normalizedIntent || 'default'}`
      },
      secondary: {
        text: matched.secondary || defaults.secondary || policy?.fallback?.secondaryLabel || 'Cancel',
        confidence: 'high',
        reason: `Matched form intent: ${normalizedIntent || 'default'}`
      }
    };
  }

  return {
    primary: {
      text: defaults.primary || policy?.fallback?.primaryLabel || 'Submit',
      confidence: 'low',
      reason: 'No intent-specific label rule found; using default'
    },
    secondary: {
      text: defaults.secondary || policy?.fallback?.secondaryLabel || 'Cancel',
      confidence: 'low',
      reason: 'No intent-specific label rule found; using default'
    }
  };
}

function createStages(fieldDefinitions, actionDefinitions, actionLabels) {
  const primaryButton = {
    component: 'comp.button.primary',
    label: actionLabels.primary.text,
    labelMeta: {
      confidence: actionLabels.primary.confidence,
      reason: actionLabels.primary.reason
    },
    variant: { Size: 'Base ✦', Style: 'Fill', Hover: 'False' },
    leftIcon: actionDefinitions.primary.leftIcon
  };
  const secondaryButton = {
    component: 'comp.button.secondary',
    label: actionLabels.secondary.text,
    labelMeta: {
      confidence: actionLabels.secondary.confidence,
      reason: actionLabels.secondary.reason
    },
    variant: { Size: 'Base ✦', Style: 'Border', Hover: 'False' },
    leftIcon: actionDefinitions.secondary.leftIcon
  };

  const stage1Fields = fieldDefinitions.map((field) => ({
    label: field.label,
    component: field.component,
    state: 'Default',
    value: '',
    placeholder: field.placeholder,
    leftIcon: field.leftIcon
  }));

  const stage2Fields = fieldDefinitions.map((field, idx) => ({
    label: field.label,
    component: field.component,
    state: idx < 2 ? 'Filled' : 'Default',
    value: idx < 2 ? field.sampleValue : '',
    placeholder: field.placeholder,
    leftIcon: field.leftIcon
  }));

  const stage3Fields = fieldDefinitions.map((field) => ({
    label: field.label,
    component: field.component,
    state: 'Filled',
    value: field.sampleValue,
    placeholder: field.placeholder,
    leftIcon: field.leftIcon
  }));

  return [
    {
      stage: 'Stage 1',
      description: 'All fields in default state when user first sees the UI.',
      fields: stage1Fields,
      actions: [primaryButton, secondaryButton]
    },
    {
      stage: 'Stage 2',
      description: 'User entered first two inputs.',
      fields: stage2Fields,
      actions: [primaryButton, secondaryButton]
    },
    {
      stage: 'Stage 3',
      description: 'User filled all inputs and hovered primary button.',
      fields: stage3Fields,
      actions: [
        {
          ...primaryButton,
          variant: { ...primaryButton.variant, Hover: 'True' }
        },
        secondaryButton
      ]
    }
  ];
}

function createPresetIcon(iconName, includeCandidates) {
  return {
    name: iconName,
    confidence: 'high',
    reason: 'Preset test form definition',
    candidates: includeCandidates
      ? [
          {
            icon: iconName,
            score: 3,
            matchedAliases: ['preset'],
            reason: 'Preset mapping'
          }
        ]
      : undefined
  };
}

function createStudentRegistrationStage3(includeCandidates) {
  return [
    {
      stage: 'Stage 3',
      description: 'Student Registration Form (Stage 3, regenerated with updated icons + dropdown).',
      fields: [
        {
          label: 'Student Name',
          component: 'comp.input.text.base',
          state: 'Filled',
          value: 'Aarav Sharma',
          placeholder: 'Enter name',
          leftIcon: createPresetIcon('Icon/Users', includeCandidates)
        },
        {
          label: 'Student Email',
          component: 'comp.input.text.base',
          state: 'Filled',
          value: 'aarav.sharma@student.edu',
          placeholder: 'Enter email',
          leftIcon: createPresetIcon('Icon/Portal', includeCandidates)
        },
        {
          label: 'Phone Number',
          component: 'comp.input.text.base',
          state: 'Filled',
          value: '+91 98765 43210',
          placeholder: 'Enter phone number',
          leftIcon: createPresetIcon('Icon/Mobile', includeCandidates)
        },
        {
          label: 'Student ID',
          component: 'comp.input.text.base',
          state: 'Filled',
          value: 'STU-2026-0142',
          placeholder: 'Enter ID',
          leftIcon: createPresetIcon('Icon/User-pending', includeCandidates)
        },
        {
          label: 'Department',
          component: 'comp.input.dropdown.base',
          state: 'Selected',
          value: 'Computer Science',
          placeholder: 'Select department',
          leftIcon: createPresetIcon('Icon/Billing', includeCandidates)
        },
        {
          label: 'Course',
          component: 'comp.input.dropdown.base',
          state: 'Selected',
          value: 'B.Tech',
          placeholder: 'Select course',
          leftIcon: createPresetIcon('Icon/Testcase', includeCandidates)
        },
        {
          label: 'Admission Date',
          component: 'comp.input.text.base',
          state: 'Filled',
          value: '2026-06-15',
          placeholder: 'Add date',
          leftIcon: createPresetIcon('Icon/More-circle-down', includeCandidates)
        },
        {
          label: 'Notes',
          component: 'comp.input.textarea.base',
          state: 'Filled',
          value: 'Requires hostel accommodation.',
          placeholder: 'Enter details',
          leftIcon: createPresetIcon('Icon/Edit', includeCandidates)
        }
      ],
      actions: [
        {
          component: 'comp.button.primary',
          label: 'Register Student',
          variant: { Size: 'Base ✦', Style: 'Fill', Hover: 'True' },
          leftIcon: createPresetIcon('Icon/User-previleged', includeCandidates)
        },
        {
          component: 'comp.button.secondary',
          label: 'Cancel',
          variant: { Size: 'Base ✦', Style: 'Border', Hover: 'False' },
          leftIcon: createPresetIcon('Icon/User-remove', includeCandidates)
        }
      ]
    }
  ];
}

function resolveTestFormPreset(testForm) {
  if (!testForm) return null;
  const normalized = normalizeId(testForm);
  if (['student-registration', 'student-registration-stage-3', 'student-registration-stage3'].includes(normalized)) {
    return {
      id: 'student-registration-stage3',
      formIntent: 'student registration',
      createStages: createStudentRegistrationStage3
    };
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output || 'knowledge/schemas/generated-form-stages.schema.json';
  const includeAllIcons = parseBoolean(args['include-all-icons'], true);
  const includeCandidates = parseBoolean(args['include-icon-candidates'], true);
  const candidateLimit = Number.isFinite(Number(args['candidate-limit']))
    ? Math.max(1, Number(args['candidate-limit']))
    : 5;
  const testFormPreset = resolveTestFormPreset(args['test-form']);
  if (args['test-form'] && !testFormPreset) {
    throw new Error(
      `Unknown --test-form preset: ${args['test-form']}. Supported preset: student-registration-stage3`
    );
  }
  const formIntent = args['form-intent'] || (testFormPreset ? testFormPreset.formIntent : 'default form');
  const fieldLabels = (args.fields || 'name,email,phone,message')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const iconsKnowledge = readJson(path.join('knowledge', 'components', 'knw-icons.json'));
  const icons = Array.isArray(iconsKnowledge.icons) ? iconsKnowledge.icons : [];
  const decisionPolicy = readJsonOptional(path.join('knowledge', 'ai-decisions', 'decision-policy.json'), {});
  const iconRules = readJsonOptional(path.join('knowledge', 'ai-decisions', 'icon-selection.rules.json'), {});
  const labelRules = readJsonOptional(path.join('knowledge', 'ai-decisions', 'label-selection.rules.json'), {});

  if (icons.length === 0) {
    throw new Error('No icons found in knowledge/components/knw-icons.json');
  }

  let stages;
  if (testFormPreset) {
    stages = testFormPreset.createStages(includeCandidates);
  } else {
    const fieldDefinitions = fieldLabels.map((label) => {
      const iconSelection = chooseIconForIntent(label, 'input_left', icons, candidateLimit, iconRules, decisionPolicy);
      const leftIcon = {
        name: iconSelection.icon,
        confidence: iconSelection.confidence,
        reason: iconSelection.reason
      };
      if (includeCandidates) {
        leftIcon.candidates = iconSelection.candidates;
      }
      return {
        label: toDisplayLabel(label),
        component: pickInputComponent(label),
        placeholder: derivePlaceholder(label),
        sampleValue: deriveSampleValue(label),
        leftIcon
      };
    });

    const primaryActionIcon = chooseIconForIntent('submit primary action', 'button_left', icons, candidateLimit, iconRules, decisionPolicy);
    const secondaryActionIcon = chooseIconForIntent('cancel secondary action', 'button_left', icons, candidateLimit, iconRules, decisionPolicy);
    const actionLabels = resolveActionLabels(formIntent, labelRules, decisionPolicy);

    const actionDefinitions = {
      primary: {
        leftIcon: {
          name: primaryActionIcon.icon,
          confidence: primaryActionIcon.confidence,
          reason: primaryActionIcon.reason,
          candidates: includeCandidates ? primaryActionIcon.candidates : undefined
        }
      },
      secondary: {
        leftIcon: {
          name: secondaryActionIcon.icon,
          confidence: secondaryActionIcon.confidence,
          reason: secondaryActionIcon.reason,
          candidates: includeCandidates ? secondaryActionIcon.candidates : undefined
        }
      }
    };
    stages = createStages(fieldDefinitions, actionDefinitions, actionLabels);
  }

  const payload = {
    schema: 'generated/form-stages/v2',
    generatedAt: new Date().toISOString(),
    source: {
      icons: 'knowledge/components/knw-icons.json',
      rules: 'knowledge/rules/DesignRulesEngine.json'
    },
    aiHints: {
      resolver: 'alias + slot aware scoring + policy fallback + label intent mapping',
      slots: ['input_left', 'button_left'],
      notes: [
        'Use candidates for fallback or tie-break in downstream AI flows.',
        'Confidence is heuristic and should be validated for production.',
        'Stage 1 fields use placeholder text with empty value.'
      ]
    },
    decisionConfig: {
      policyFile: 'knowledge/ai-decisions/decision-policy.json',
      iconRulesFile: 'knowledge/ai-decisions/icon-selection.rules.json',
      labelRulesFile: 'knowledge/ai-decisions/label-selection.rules.json'
    },
    formIntent,
    formShell: {
      form: 'gr.comp.form',
      section: 'gr.comp.area',
      pattern: 'sub.pt.form'
    },
    iconSettings: {
      includeAllIcons,
      includeCandidates,
      candidateLimit
    },
    testFormPreset: testFormPreset ? testFormPreset.id : undefined,
    iconCatalog: includeAllIcons
      ? icons.map((icon) => ({
          name: icon.name,
          aliases: Array.isArray(icon.aliases) ? icon.aliases : [],
          type: icon.type || 'COMPONENT'
        }))
      : undefined,
    stages
  };

  const absoluteOutputPath = path.join(ROOT, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  fs.writeFileSync(absoluteOutputPath, JSON.stringify(payload, null, 2));

  console.log(`Generated form schema: ${outputPath}`);
}

main();
