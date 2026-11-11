import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import release from './android-release.cjs';

const [apk, aab, reportDirectory, bundleConfigFile] = process.argv.slice(2);
assert.ok(apk && aab && reportDirectory && bundleConfigFile, 'Provide APK, AAB, report directory, and bundletool config JSON');
const bundleAlignment = release.validateBundleConfig(fs.readFileSync(bundleConfigFile, 'utf8'));
const sdk = process.env.ANDROID_SDK_ROOT;
assert.ok(sdk, 'ANDROID_SDK_ROOT is required');
const buildTools = path.join(sdk, 'build-tools', '36.0.0');
const badging = execFileSync(path.join(buildTools, 'aapt'), ['dump', 'badging', apk], { encoding: 'utf8' });
const metadata = release.validateApkMetadata(badging, Number(process.env.PF_ANDROID_VERSION_CODE));
execFileSync(path.join(buildTools, 'zipalign'), ['-c', '-P', '16', '4', apk], { stdio: 'inherit' });
const libraries = [];
for (const archive of [apk, aab]) {
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n')
    .filter((name) => /^(?:base\/)?lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/.test(name));
  assert.ok(entries.some((entry) => entry.includes('/arm64-v8a/')), 'Missing Android arm64 native libraries');
  for (const entry of entries) {
    const bytes = execFileSync('unzip', ['-p', archive, entry], { maxBuffer: 128 * 1024 * 1024 });
    try {
      const segments = release.validateElfAlignment(bytes);
      libraries.push({ archive: path.basename(archive), library: entry, loadSegments: segments });
    } catch (error) {
      throw new Error(`${path.basename(archive)} ${entry}: ${error.message}`);
    }
  }
}
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, 'android-validation-report.json'), JSON.stringify({ ...metadata, zipAligned16KB: true, bundleAlignment, relroChecked16KB: true, libraries }, null, 2) + '\n');
console.log(`Release binaries validated: target API ${metadata.targetSdk}, ${bundleAlignment}; ${libraries.length} native libraries checked for 16 KB LOAD and RELRO alignment.`);
