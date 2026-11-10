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
