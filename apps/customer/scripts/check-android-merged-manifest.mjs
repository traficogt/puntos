import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import release from './android-release.cjs';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');
const root = fileURLToPath(new URL('../', import.meta.url));
const versionCode = Number(process.env.PF_ANDROID_VERSION_CODE);
assert.ok(Number.isInteger(versionCode) && versionCode > 0, 'PF_ANDROID_VERSION_CODE is required for merged manifest validation');
const filename = release.findMergedReleaseManifest(path.join(root, 'android/app/build/intermediates'));
const reports = process.env.PF_ANDROID_ARTIFACTS_DIR || path.join(root, 'build/android-release');
fs.mkdirSync(reports, { recursive: true });
// Retain the offending merged manifest even when validation stops the build.
fs.copyFileSync(filename, path.join(reports, 'merged-manifest-report.xml'));
const document = await AndroidConfig.Manifest.readAndroidManifestAsync(filename);
const result = release.validateMergedReleaseManifest(document, versionCode);
fs.writeFileSync(path.join(reports, 'merged-manifest-validation-report.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Merged release manifest valid before compilation: ${result.package}, version ${result.versionCode}, API ${result.targetSdk}, ${result.permissions.length} allowed permissions.`);
