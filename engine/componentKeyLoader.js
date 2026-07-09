const fs = require('fs');
const path = require('path');

const KEY_MAP_PATH = path.join(process.cwd(), 'Tokens', 'meta', 'component-key-map.json');

let _cache = null;

function loadKeyMap() {
  if (_cache) return _cache;
  if (!fs.existsSync(KEY_MAP_PATH)) return {};
  try {
    _cache = JSON.parse(fs.readFileSync(KEY_MAP_PATH, 'utf8'));
    return _cache;
  } catch {
    return {};
  }
}

function resolveComponentKey(componentName) {
  if (!componentName) return null;
  const map = loadKeyMap();
  return map[componentName] || map[String(componentName).toLowerCase()] || null;
}

module.exports = { resolveComponentKey };
