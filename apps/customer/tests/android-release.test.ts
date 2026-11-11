import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const helperPath = new URL('../scripts/android-release.cjs', import.meta.url);
const pluginPath = new URL('../plugins/with-android-release.cjs', import.meta.url);
const signing = {
  PF_ANDROID_KEYSTORE_BASE64: Buffer.from('fixture keystore bytes').toString('base64'),
  PF_ANDROID_STORE_PASSWORD: 'fixture store password',
  PF_ANDROID_KEY_PASSWORD: 'fixture key password',
  PF_ANDROID_KEY_ALIAS: 'pf-upload',
  PROJECT_BUILD_NUMBER: '17',
};

test('release preparation fails closed for every missing credential without revealing values', () => {
  assert.ok(fs.existsSync(helperPath), 'Android release validation helper is required');
  const { readReleaseEnvironment } = require(helperPath.pathname);
  for (const name of Object.keys(signing).filter((key) => key !== 'PROJECT_BUILD_NUMBER')) {
    for (const missing of [undefined, '', '   ']) {
      assert.throws(() => readReleaseEnvironment({ ...signing, [name]: missing }), (error: Error) => {
        assert.ok(error.message.includes(name));
        assert.ok(!error.message.includes(signing.PF_ANDROID_STORE_PASSWORD));
        return true;
      });
    }
  }
});

test('version codes use the project counter plus one or an explicit positive Play version', () => {
  const { readReleaseEnvironment } = require(helperPath.pathname);
  assert.equal(readReleaseEnvironment(signing).versionCode, 18);
  assert.equal(readReleaseEnvironment({ ...signing, PROJECT_BUILD_NUMBER: '0' }).versionCode, 1);
  assert.equal(readReleaseEnvironment({ ...signing, PF_ANDROID_VERSION_CODE: '2100000000' }).versionCode, 2100000000);
  for (const value of ['', '0', '-1', '1.5', '1e3', '2147483647', ' 12 ']) {
    assert.throws(() => readReleaseEnvironment({ ...signing, PF_ANDROID_VERSION_CODE: value }), /PF_ANDROID_VERSION_CODE/);
  }
  for (const value of [undefined, '', '-1', '1.5', '2100000000']) {
    assert.throws(() => readReleaseEnvironment({ ...signing, PROJECT_BUILD_NUMBER: value }), /PROJECT_BUILD_NUMBER/);
  }
});

test('keystore bytes require canonical base64 and an explicit supported store type', () => {
  const { readReleaseEnvironment } = require(helperPath.pathname);
  assert.equal(readReleaseEnvironment(signing).storeType, 'PKCS12');
  assert.equal(readReleaseEnvironment({ ...signing, PF_ANDROID_STORE_TYPE: 'JKS' }).storeType, 'JKS');
  for (const value of ['@@@', 'a', 'Zg', '', '====']) {
    assert.throws(() => readReleaseEnvironment({ ...signing, PF_ANDROID_KEYSTORE_BASE64: value }), /PF_ANDROID_KEYSTORE_BASE64/);
  }
  assert.throws(() => readReleaseEnvironment({ ...signing, PF_ANDROID_STORE_TYPE: 'PEM' }), /PF_ANDROID_STORE_TYPE/);
  assert.throws(() => readReleaseEnvironment({ ...signing, PF_ANDROID_KEY_ALIAS: 'androiddebugkey' }), /debug/i);
});

test('materialized keystores are private, preserve bytes, and cannot overwrite an existing path', () => {
  const { prepareSigning } = require(helperPath.pathname);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-android-test-'));
  const filename = path.join(temporary, 'upload.keystore');
  try {
    const result = prepareSigning(signing, filename);
    assert.equal(result.versionCode, 18);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'fixture keystore bytes');
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    assert.throws(() => prepareSigning(signing, filename), /exist/i);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('the installed Expo template gets a fail-closed release signer and remains idempotent', () => {
  assert.ok(fs.existsSync(pluginPath), 'Android release config plugin is required');
  const { configureReleaseGradle } = require(pluginPath.pathname);
  const template = execFileSync('tar', ['-xOzf', path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz'), 'package/android/app/build.gradle'], { encoding: 'utf8' });
  const result = configureReleaseGradle(template);
  assert.match(result, /release\s*\{\s*signingConfig signingConfigs\.pfRelease/);
  assert.doesNotMatch(result, /release\s*\{[^}]*signingConfigs\.debug/);
  assert.match(result, /storeType System\.getenv\('PF_ANDROID_STORE_TYPE'\)/);
  assert.match(result, /gradle\.taskGraph\.whenReady/);
  assert.match(result, /PF_ANDROID_VERSION_CODE/);
  assert.equal(configureReleaseGradle(result), result);
  assert.throws(() => configureReleaseGradle('android { }'), /template/i);
});

test('Android Firebase auto-init is disabled using valid manifest attributes', async () => {
  const plugin = require(pluginPath.pathname);
  const config = plugin({ name: 'PF', slug: 'pf' });
  const result = await config.mods.android.manifest({
    ...config,
    modResults: { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } },
    modRequest: { platform: 'android', modName: 'manifest' },
  });
  const metadata = result.modResults.manifest.application[0]['meta-data'];
  for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled']) {
    const attributes = metadata.find((item: any) => item.$['android:name'] === name).$;
    assert.equal(attributes['android:value'], 'false');
    assert.equal(attributes['android:android:value'], undefined);
  }
});

test('artifact metadata rejects wrong identity, low targets, debug builds and unexpected permissions', () => {
  const { validateApkMetadata } = require(helperPath.pathname);
  const good = "package: name='com.puntosfieles.customer' versionCode='18' versionName='0.1.0'\ntargetSdkVersion:'36'\nuses-permission: name='android.permission.INTERNET'\nuses-permission: name='android.permission.ACCESS_NETWORK_STATE'\n";
  assert.equal(typeof validateApkMetadata, 'function');
  assert.equal(validateApkMetadata(good, 18).targetSdk, 36);
  assert.ok(validateApkMetadata(good + "uses-permission: name='android.permission.ACCESS_WIFI_STATE'\n", 18).permissions.includes('android.permission.ACCESS_WIFI_STATE'));
  for (const bad of [good.replace('customer', 'other'), good.replace("versionCode='18'", "versionCode='17'"), good.replace("targetSdkVersion:'36'", "targetSdkVersion:'35'"), good + 'application-debuggable\n', good + "uses-permission: name='android.permission.POST_NOTIFICATIONS'\n"]) {
    assert.throws(() => validateApkMetadata(bad, 18));
  }
});

test('native library validation accepts 16 KB ELF segments and rejects 4 KB or malformed headers', () => {
  const { validateElfAlignment } = require(helperPath.pathname);
  assert.equal(typeof validateElfAlignment, 'function');
  const library = Buffer.alloc(120);
  library.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  library.writeBigUInt64LE(64n, 32);
  library.writeUInt16LE(56, 54);
  library.writeUInt16LE(1, 56);
  library.writeUInt32LE(1, 64);
  library.writeBigUInt64LE(16384n, 112);
  assert.equal(validateElfAlignment(library), 1);
  library.writeBigUInt64LE(4096n, 112);
  assert.throws(() => validateElfAlignment(library), /16 KB/);
  assert.throws(() => validateElfAlignment(Buffer.alloc(120)), /ELF/);
  assert.throws(() => validateElfAlignment(library.subarray(0, 80)), /header/);
  library.writeUInt32LE(0, 64);
  assert.throws(() => validateElfAlignment(library), /LOAD/);
});

function elf64(headers: { type: number; flags: number; address: bigint; memorySize: bigint; alignment?: bigint }[]) {
  const bytes = Buffer.alloc(64 + 56 * headers.length);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(headers.length, 56);
  headers.forEach((header, index) => {
    const start = 64 + index * 56;
    bytes.writeUInt32LE(header.type, start);
    bytes.writeUInt32LE(header.flags, start + 4);
    bytes.writeBigUInt64LE(header.address, start + 16);
    bytes.writeBigUInt64LE(header.memorySize, start + 40);
    bytes.writeBigUInt64LE(header.alignment ?? 16384n, start + 48);
  });
  return bytes;
}

test('unaligned RELRO rejects trailing writable memory even when every LOAD has 16 KB alignment', () => {
  const { validateElfAlignment } = require(helperPath.pathname);
  const writable = { type: 1, flags: 6, address: 0xdfaf0n, memorySize: 0x4510n };
  const relro = { type: 0x6474e552, flags: 4, address: 0xdfaf0n, memorySize: 0x1510n, alignment: 1n };
  // ELF file sizes are zero in this fixture: the check must include writable BSS via MemSiz.
  assert.throws(() => validateElfAlignment(elf64([writable, relro])), /RELRO.*16 KB/);
  // Relro may start inside its containing writable segment.
  assert.throws(() => validateElfAlignment(elf64([writable, { ...relro, address: 0xe0000n, memorySize: 0x1000n }])), /RELRO.*16 KB/);
});

test('RELRO accepts aligned ends, exact LOAD ends, and segments without following writable data', () => {
  const { validateElfAlignment } = require(helperPath.pathname);
  const writable = { type: 1, flags: 6, address: 0xdfaf0n, memorySize: 0x3510n };
  const relro = { type: 0x6474e552, flags: 4, address: 0xdfaf0n, memorySize: 0x510n, alignment: 1n };
  assert.equal(validateElfAlignment(elf64([writable, relro])), 1);
  const exactEnd = { type: 1, flags: 6, address: 0x4680n, memorySize: 0x980n };
  assert.equal(validateElfAlignment(elf64([exactEnd, { ...relro, address: 0x4680n, memorySize: 0x980n }])), 1);
  assert.equal(validateElfAlignment(elf64([writable])), 1);
  assert.equal(validateElfAlignment(elf64([{ ...writable, flags: 4 }, { ...relro, memorySize: 0x1510n }])), 1);
  // An unrelated writable LOAD must not be treated as RELRO's containing segment.
  assert.equal(validateElfAlignment(elf64([exactEnd, { ...writable, address: 0x8000n }, { ...relro, address: 0x4680n, memorySize: 0x980n }])), 2);
});

test('AAB config requires explicit 16 KB uncompressed native-library alignment', () => {
  const { validateBundleConfig } = require(helperPath.pathname);
  assert.equal(typeof validateBundleConfig, 'function');
  const config = (value: unknown) => JSON.stringify({ optimizations: { uncompressNativeLibraries: value } });
  assert.equal(validateBundleConfig(config({ enabled: true, alignment: 'PAGE_ALIGNMENT_16K' })), 'PAGE_ALIGNMENT_16K');
  for (const bad of ['', '{', 'null', '{}', '{"alignment":"PAGE_ALIGNMENT_16K"}', config({}), config({ enabled: true }), config({ enabled: false, alignment: 'PAGE_ALIGNMENT_16K' }), config({ enabled: true, alignment: 'PAGE_ALIGNMENT_4K' }), config({ enabled: true, alignment: 'PAGE_ALIGNMENT_64K' }), config({ enabled: true, alignment: 2 })]) {
    assert.throws(() => validateBundleConfig(bad), /bundle|alignment/i);
  }
});

const mergedManifestXml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.puntosfieles.customer" android:versionCode="18">
  <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" />
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <application android:name=".MainApplication" android:allowBackup="false" />
</manifest>`;

test('merged release manifest is parsed with Expo and enforces identity before compilation', async () => {
  const { validateMergedReleaseManifest } = require(helperPath.pathname);
  assert.equal(typeof validateMergedReleaseManifest, 'function');
  const { AndroidConfig } = require('expo/config-plugins');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-merged-manifest-'));
  const filename = path.join(temporary, 'AndroidManifest.xml');
  try {
    fs.writeFileSync(filename, mergedManifestXml);
    const parsed = await AndroidConfig.Manifest.readAndroidManifestAsync(filename);
    assert.equal(validateMergedReleaseManifest(parsed, 18).targetSdk, 36);
    for (const mutated of [
      mergedManifestXml.replace('com.puntosfieles.customer', 'com.example.other'),
      mergedManifestXml.replace('versionCode="18"', 'versionCode="17"'),
      mergedManifestXml.replace('targetSdkVersion="36"', 'targetSdkVersion="35"'),
      mergedManifestXml.replace('<application ', '<application android:debuggable="true" '),
    ]) {
      fs.writeFileSync(filename, mutated);
      const invalid = await AndroidConfig.Manifest.readAndroidManifestAsync(filename);
      assert.throws(() => validateMergedReleaseManifest(invalid, 18));
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('merged manifest rejects transitive install referrer and SDK-qualified permissions', () => {
  const { validateMergedReleaseManifest } = require(helperPath.pathname);
  assert.equal(typeof validateMergedReleaseManifest, 'function');
  const manifest = {
    $: { package: 'com.puntosfieles.customer', 'android:versionCode': '18' },
    'uses-sdk': [{ $: { 'android:targetSdkVersion': '36' } }],
    'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }],
    application: [{ $: { 'android:allowBackup': 'false' } }],
  };
  for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
    const invalid: any = structuredClone(manifest);
    invalid[tag] = [...(invalid[tag] ?? []), { $: { 'android:name': 'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE' } }];
    assert.throws(() => validateMergedReleaseManifest({ manifest: invalid }, 18), /Unexpected release permission/);
  }
});

test('merged manifest discovery accepts only the requested release merge task and fails on ambiguity', () => {
  const { findMergedReleaseManifest } = require(helperPath.pathname);
  assert.equal(typeof findMergedReleaseManifest, 'function');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-merged-discovery-'));
  const candidate = path.join(temporary, 'merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml');
  const other = path.join(temporary, 'merged_manifests/release/processReleaseMainManifest/AndroidManifest.xml');
  const debug = path.join(temporary, 'merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml');
  try {
    fs.mkdirSync(path.dirname(debug), { recursive: true });
    fs.writeFileSync(debug, mergedManifestXml);
    assert.throws(() => findMergedReleaseManifest(temporary), /exactly one/i);
    fs.mkdirSync(path.dirname(candidate), { recursive: true });
    fs.writeFileSync(candidate, mergedManifestXml);
    assert.equal(findMergedReleaseManifest(temporary), candidate);
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, mergedManifestXml);
    assert.throws(() => findMergedReleaseManifest(temporary), /exactly one/i);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('app configuration removes the unused install-referrer permission', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.ok(config.expo.android.blockedPermissions.includes('com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE'));
});

const approvedMergedPermissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'com.puntosfieles.customer.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];

test('blocked permission projection removes every unused permission from the actual cloud manifest', async () => {
  const { AndroidConfig } = require('expo/config-plugins');
  const { validateMergedReleaseManifest } = require(helperPath.pathname);
  const fixture = await AndroidConfig.Manifest.readAndroidManifestAsync(new URL('./fixtures/android-merged-permissions-20261110.xml', import.meta.url).pathname);
  const config = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const blocked = new Set(config.expo.android.blockedPermissions);
  const entries = fixture.manifest['uses-permission'];
  assert.equal(entries.length, 20);
  const remaining = entries.filter((entry: any) => !blocked.has(entry.$['android:name']));
  assert.deepEqual(remaining.map((entry: any) => entry.$['android:name']), approvedMergedPermissions);
  const manifest = {
    $: { package: 'com.puntosfieles.customer', 'android:versionCode': '1' },
    'uses-sdk': [{ $: { 'android:targetSdkVersion': '36' } }],
    'uses-permission': remaining,
    application: [{ $: { 'android:allowBackup': 'false' } }],
  };
  assert.equal(validateMergedReleaseManifest({ manifest }, 1).permissions.length, 4);
});

test('each badge permission seen in the cloud manifest remains forbidden by the final APK validator', async () => {
  const { AndroidConfig } = require('expo/config-plugins');
  const { validateApkMetadata } = require(helperPath.pathname);
  const fixture = await AndroidConfig.Manifest.readAndroidManifestAsync(new URL('./fixtures/android-merged-permissions-20261110.xml', import.meta.url).pathname);
  const extras = fixture.manifest['uses-permission'].map((entry: any) => entry.$['android:name'])
    .filter((permission: string) => !approvedMergedPermissions.includes(permission));
  assert.equal(extras.length, 16);
  const badging = "package: name='com.puntosfieles.customer' versionCode='1'\ntargetSdkVersion:'36'\nuses-permission: name='android.permission.INTERNET'\n";
  for (const permission of extras) {
    assert.throws(() => validateApkMetadata(`${badging}uses-permission: name='${permission}'\n`, 1), /Unexpected release permission/);
  }
});
