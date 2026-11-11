// Expo Router expects query-string 7's CommonJS API. Its decoder has a security
// fix in 0.5.1, which exports ESM. Keep the API and adapt only that import.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const original = "const decodeComponent = require('decode-uri-component');";
const replacement = "const decodeModule = require('decode-uri-component');\nconst decodeComponent = decodeModule.default || decodeModule;";
let found = 0;
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.endsWith('node_modules/query-string')) continue;
  assert.equal(entry.version, '7.1.3', 'Review the interop patch before upgrading query-string');
  const target = path.resolve(root, location, 'index.js');
  assert.ok(target.startsWith(path.join(root, 'node_modules') + path.sep));
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(replacement)) {
    assert.ok(source.includes(original), 'query-string decoder import changed; review before patching');
    fs.writeFileSync(target, source.replace(original, replacement));
  }
  found++;
}
assert.ok(found > 0, 'Expected locked query-string dependency');
console.log(`Checked query-string decoder compatibility in ${found} package(s).`);
