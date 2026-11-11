import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* eslint security/detect-non-literal-fs-filename: off */
const script = fileURLToPath(new URL('../../src/scripts/security-scan.mjs', import.meta.url));
function scan(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-security-scan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

test('pattern scan checks maintained merchant source rather than generated React distributions', t => {
  const result = scan(t, {
    'public/merchant/assets/index-example.js': 'element.innerHTML = value;',
    'public/merchant/recursos/index-example.js': 'element.innerHTML = value;',
    'web/merchant/src/Screen.jsx': 'element.textContent = value;'
  });
  assert.equal(result.status, 0, result.stderr);
});

test('pattern scan still blocks DOM sinks outside the exact generated directories', t => {
  for (const file of ['public/staff/screen.js', 'public/merchant/screen.js', 'web/merchant/src/Screen.jsx']) {
    const result = scan(t, { [file]: 'element.innerHTML = value;' });
    assert.equal(result.status, 1, file);
    assert.match(result.stderr, /dangerous-dom-sink/);
    assert.ok(result.stderr.includes(file));
  }
});

test('pattern scan blocks React raw HTML and dynamic code execution in merchant source', t => {
  for (const source of ['const view = <div dangerouslySetInnerHTML={value} />;', 'eval(value);', 'new Function(value);']) {
    const result = scan(t, { 'web/merchant/src/Screen.jsx': source });
    assert.equal(result.status, 1, source);
  }
});
