import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const project = require('xcode').project(path.join(root, 'ios/PuntosFieles.xcodeproj/project.pbxproj'));
project.parseSync();
const targets = project.pbxNativeTargetSection();
const appTargets = Object.entries(targets).filter(([, value]) => value?.isa === 'PBXNativeTarget');
assert.equal(appTargets.length, 1);
const scheme = fs.readFileSync(path.join(root, 'ios/PuntosFieles.xcodeproj/xcshareddata/xcschemes/PuntosFieles.xcscheme'), 'utf8');
for (const match of scheme.matchAll(/BlueprintIdentifier\s*=\s*"([^"]+)"/g)) {
  assert.ok(targets[match[1]], `Scheme references missing target ${match[1]}`);
}
assert.match(scheme, /ArchiveAction\s+buildConfiguration\s*=\s*"Release"/);
const unquote = (value) => String(value).replace(/^"|"$/g, '');
let checkedConfigurations = 0;
for (const entry of Object.values(project.pbxXCBuildConfigurationSection())) {
  const settings = entry?.buildSettings;
  if (!settings?.PRODUCT_BUNDLE_IDENTIFIER) continue;
  assert.equal(unquote(settings.PRODUCT_BUNDLE_IDENTIFIER), config.ios.bundleIdentifier);
  assert.equal(unquote(settings.DEVELOPMENT_TEAM), config.ios.appleTeamId);
  assert.equal(unquote(settings.CODE_SIGN_STYLE), 'Automatic');
  assert.equal(unquote(settings.MARKETING_VERSION), config.version);
  checkedConfigurations++;
}
assert.equal(checkedConfigurations, 2);
const workspace = fs.readFileSync(path.join(root, 'ios/PuntosFieles.xcworkspace/contents.xcworkspacedata'), 'utf8');
assert.match(workspace, /group:PuntosFieles.xcodeproj/);
assert.match(workspace, /group:Pods\/Pods.xcodeproj/);
const script = path.join(root, 'ios/ci_scripts/ci_post_clone.sh');
assert.equal(fs.readFileSync(script, 'utf8'), fs.readFileSync(path.join(root, 'ci/xcode-cloud/ci_post_clone.sh'), 'utf8'));
assert.ok(fs.statSync(script).mode & 0o111, 'Xcode Cloud script must be executable');
execFileSync('bash', ['-n', script]);
console.log('Xcode Cloud configuration valid: workspace, shared scheme, target references, signing settings, and script.');
if (!fs.existsSync(path.join(root, 'ios/Podfile.lock'))) {
  console.log('Pending macOS validation: first CocoaPods lockfile and an actual Xcode archive.');
}
