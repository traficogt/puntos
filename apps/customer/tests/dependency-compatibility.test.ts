import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const fingerprintRequire = createRequire(require.resolve('@expo/fingerprint/package.json'));
const fingerprintPaths = fingerprintRequire('./build/utils/Path.js');

test('fingerprint preserves nested gitignore discovery and native workflow classification', async () => {
  const { glob } = fingerprintRequire('glob');
  const { resolveProjectWorkflowAsync } = fingerprintRequire('./build/ProjectWorkflow.js');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-workflow-'));
  try {
    fs.mkdirSync(path.join(temporary, 'ios/Fixture.xcodeproj'), { recursive: true });
    fs.mkdirSync(path.join(temporary, 'node_modules/ignored'), { recursive: true });
    fs.symlinkSync(path.dirname(require.resolve('expo/package.json')), path.join(temporary, 'node_modules/expo'), 'dir');
    fs.writeFileSync(path.join(temporary, 'ios/Fixture.xcodeproj/project.pbxproj'), '// workflow marker');
    fs.writeFileSync(path.join(temporary, '.gitignore'), '');
    fs.writeFileSync(path.join(temporary, 'ios/.gitignore'), '*.pbxproj\n');
    fs.writeFileSync(path.join(temporary, 'node_modules/ignored/.gitignore'), '*\n');
    const files = await glob('**/.gitignore', { cwd: temporary, ignore: ['node_modules'], follow: false });
    assert.deepEqual(files.filter((file: string) => !file.startsWith('node_modules/')).sort(), ['.gitignore', 'ios/.gitignore']);
    assert.equal(await resolveProjectWorkflowAsync(temporary, 'ios', []), 'managed');
    fs.writeFileSync(path.join(temporary, 'ios/.gitignore'), '');
    assert.equal(await resolveProjectWorkflowAsync(temporary, 'ios', []), 'generic');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('fingerprint ignore matching preserves native sources and negated exceptions', () => {
  const patterns = ['**/build/**/*', '**/Pods/**/*', '**/.cache/**', '!**/build/keep.txt'];
  for (const [filename, ignored] of [
    ['android/app/build/output.apk', true],
    ['ios/Pods/Expo/Core.swift', true],
    ['../module/.cache/index', true],
    ['android/app/build/keep.txt', false],
    ['android/app/src/main/MainApplication.kt', false],
    ['ios/PuntosFieles/SceneDelegate.swift', false],
  ] as const) {
    assert.equal(fingerprintPaths.isIgnoredPath(filename, patterns), ignored, filename);
  }
  const matchers = fingerprintPaths.buildPathMatchObjects(['native/**', '!native/keep/source.swift']);
  const directories = fingerprintPaths.buildDirMatchObjects(matchers);
  assert.equal(fingerprintPaths.isIgnoredPathWithMatchObjects('native', directories), false);
});

test('TypeScript ESLint project matching keeps ordinary glob and dotfile behavior', () => {
  const parserRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree/package.json'));
  const { Minimatch } = parserRequire('minimatch');
  const matcher = new Minimatch('src/**/*.{ts,tsx}', { dot: true });
  assert.equal(matcher.match('src/app/(tabs)/card.tsx'), true);
  assert.equal(matcher.match('src/.generated/types.ts'), true);
  assert.equal(matcher.match('src/theme.js'), false);
  assert.equal(new Minimatch('**/node_modules/**', { dot: true }).match('packages/app/node_modules/pkg/index.ts'), true);
});

test('fingerprints are deterministic, ignore generated files, and detect native source edits', async () => {
  const { createFingerprintAsync } = fingerprintRequire('./build/index.js');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-fingerprint-'));
  try {
    fs.mkdirSync(path.join(temporary, 'native/generated'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'package.json'), '{"name":"fingerprint-fixture","version":"1.0.0"}');
    fs.writeFileSync(path.join(temporary, '.fingerprintignore'), 'native/generated/**\n');
    fs.writeFileSync(path.join(temporary, 'native/source.swift'), '// native fixture version 1\n');
    fs.writeFileSync(path.join(temporary, 'native/generated/output.txt'), 'first generated output');
    const options = {
      platforms: [],
      concurrentIoLimit: 1,
      silent: true,
      extraSources: [{ type: 'dir', filePath: 'native', reasons: ['compatibility fixture'] }],
    };
    const first = await createFingerprintAsync(temporary, options);
    assert.equal((await createFingerprintAsync(temporary, options)).hash, first.hash);
    fs.writeFileSync(path.join(temporary, 'native/generated/output.txt'), 'changed generated output');
    assert.equal((await createFingerprintAsync(temporary, options)).hash, first.hash);
    fs.writeFileSync(path.join(temporary, 'native/source.swift'), '// native fixture version 2\n');
    assert.notEqual((await createFingerprintAsync(temporary, options)).hash, first.hash);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
