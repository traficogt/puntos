import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { AndroidConfig } = require('expo/config-plugins');
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const android = path.join(root, 'android');
const read = (name) => fs.readFileSync(path.join(android, name), 'utf8');
const gradle = read('app/build.gradle');
assert.match(gradle, /applicationId ['"]com\.puntosfieles\.customer['"]/);
assert.match(gradle, /release\s*\{\s*signingConfig signingConfigs\.pfRelease/);
assert.doesNotMatch(gradle, /release\s*\{[^}]*signingConfigs\.debug/);
assert.match(gradle, /gradle\.taskGraph\.whenReady/);
assert.match(gradle, /versionCode pfVersionCode/);
assert.match(gradle, /targetSdkVersion rootProject\.ext\.targetSdkVersion/);
assert.match(read('settings.gradle'), /expoAutolinking\.useExpoVersionCatalog\(\)/);
const versions = fs.readFileSync(path.join(path.dirname(require.resolve('react-native/package.json')), 'gradle/libs.versions.toml'), 'utf8');
const targetSdk = Number(versions.match(/^targetSdk = "(\d+)"/m)?.[1]);
assert.ok(targetSdk >= 36, 'Expo/RN target SDK must be at least API 36');
const properties = read('gradle.properties');
assert.match(properties, /^newArchEnabled=true$/m);
assert.match(properties, /^hermesEnabled=true$/m);
assert.match(properties, /^expo\.useLegacyPackaging=false$/m);
assert.doesNotMatch(properties, /^android\.(targetSdkVersion|compileSdkVersion)=/m, 'Review Android SDK overrides');
const { manifest } = await AndroidConfig.Manifest.readAndroidManifestAsync(path.join(android, 'app/src/main/AndroidManifest.xml'));
const application = manifest.application[0];
assert.equal(application.$['android:allowBackup'], 'false');
assert.equal(application.$['android:enableOnBackInvokedCallback'], 'true');
assert.equal(application.$['android:usesCleartextTraffic'], undefined);
for (const name of config.android.blockedPermissions) {
  assert.ok(manifest['uses-permission'].some((item) => item.$['android:name'] === name && item.$['tools:node'] === 'remove'), `Missing blocked permission ${name}`);
}
for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled']) {
  assert.ok(application['meta-data'].some((item) => item.$['android:name'] === name && item.$['android:value'] === 'false'), `Missing disabled ${name}`);
}
console.log(`Android project valid: API ${targetSdk}, upload signing, protected backup, predictive back, Hermes and New Architecture; unused permissions blocked.`);
