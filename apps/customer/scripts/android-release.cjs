const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const MAX_VERSION_CODE = 2100000000;

function readReleaseEnvironment(env) {
  for (const name of ['PF_ANDROID_KEYSTORE_BASE64', 'PF_ANDROID_STORE_PASSWORD', 'PF_ANDROID_KEY_PASSWORD', 'PF_ANDROID_KEY_ALIAS']) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Missing ${name}`);
  }
  if (env.PF_ANDROID_KEY_ALIAS.toLowerCase() === 'androiddebugkey') throw new Error('Android debug signing keys cannot be used for release');
  const encoded = env.PF_ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
  const keystore = Buffer.from(encoded, 'base64');
  if (!keystore.length || keystore.toString('base64') !== encoded) throw new Error('Invalid PF_ANDROID_KEYSTORE_BASE64');
  const storeType = env.PF_ANDROID_STORE_TYPE ?? 'PKCS12';
  if (!['PKCS12', 'JKS'].includes(storeType)) throw new Error('PF_ANDROID_STORE_TYPE must be PKCS12 or JKS');

  const explicit = env.PF_ANDROID_VERSION_CODE !== undefined;
  const versionName = explicit ? 'PF_ANDROID_VERSION_CODE' : 'PROJECT_BUILD_NUMBER';
  const raw = env[versionName];
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error(`Invalid ${versionName}`);
  const versionCode = Number(raw) + (explicit ? 0 : 1);
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) throw new Error(`Invalid ${versionName}: resulting version code must be 1..${MAX_VERSION_CODE}`);
  return { keystore, storeType, versionCode };
}

function prepareSigning(env, filename) {
  const settings = readReleaseEnvironment(env);
  if (!filename || !path.isAbsolute(filename)) throw new Error('PF_ANDROID_KEYSTORE_PATH must be absolute');
  fs.writeFileSync(filename, settings.keystore, { flag: 'wx', mode: 0o600 });
  return { versionCode: settings.versionCode, storeType: settings.storeType };
}

function validateApkMetadata(badging, expectedVersionCode) {
  const identity = badging.match(/^package: name='([^']+)' versionCode='([0-9]+)'/m);
  if (!identity || identity[1] !== 'com.puntosfieles.customer' || Number(identity[2]) !== expectedVersionCode) throw new Error('Unexpected release package or version code');
  const targetSdk = Number(badging.match(/^targetSdkVersion:'([0-9]+)'/m)?.[1]);
  if (!Number.isInteger(targetSdk) || targetSdk < 36) throw new Error('Release target SDK must be at least 36');
  if (/^application-debuggable/m.test(badging)) throw new Error('Debuggable APK cannot be released');
  const permissions = [...badging.matchAll(/^uses-permission(?:-sdk-\d+)?: name='([^']+)'/gm)].map((match) => match[1]);
  validateReleasePermissions(permissions);
  return { package: identity[1], versionCode: Number(identity[2]), targetSdk, permissions };
}

function validateReleasePermissions(permissions) {
  const allowed = new Set(['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE', 'com.puntosfieles.customer.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']);
  if (!permissions.includes('android.permission.INTERNET')) throw new Error('Release network permission is missing');
  for (const permission of permissions) {
    if (!allowed.has(permission)) throw new Error(`Unexpected release permission: ${permission}`);
  }
}

function validateMergedReleaseManifest(document, expectedVersionCode) {
  const manifest = document?.manifest;
  const identity = manifest?.$;
  if (identity?.package !== 'com.puntosfieles.customer' || Number(identity['android:versionCode']) !== expectedVersionCode) throw new Error('Unexpected release package or version code in merged manifest');
  const targetSdk = Number(manifest['uses-sdk']?.[0]?.$?.['android:targetSdkVersion']);
  if (!Number.isInteger(targetSdk) || targetSdk < 36) throw new Error('Merged release target SDK must be at least 36');
  if (!manifest.application?.length || manifest.application.some((application) => application.$?.['android:debuggable'] === 'true')) throw new Error('Missing application or debuggable merged release manifest');
  const permissions = Object.entries(manifest)
    .filter(([name]) => /^uses-permission(?:-sdk-\d+)?$/.test(name))
    .flatMap(([, entries]) => entries.map((entry) => entry.$?.['android:name']));
  validateReleasePermissions(permissions);
  return { package: identity.package, versionCode: Number(identity['android:versionCode']), targetSdk, permissions };
}

function findMergedReleaseManifest(intermediates) {
  // AGP 8.12's processReleaseMainManifest output. Never select debug, library,
  // or packaged-manifest outputs merely because their filenames match.
  const candidates = ['merged_manifest', 'merged_manifests']
    .map((directory) => path.join(intermediates, directory, 'release/processReleaseMainManifest/AndroidManifest.xml'))
    .filter((filename) => fs.existsSync(filename) && fs.statSync(filename).isFile());
  if (candidates.length !== 1) throw new Error('Expected exactly one processReleaseMainManifest output under app/build/intermediates');
  return candidates[0];
}

function validateElfAlignment(bytes) {
  if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46 || bytes[4] !== 2 || bytes[5] !== 1) throw new Error('Expected a 64-bit little-endian ELF library');
  const offset = Number(bytes.readBigUInt64LE(32));
  const size = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  if (!Number.isSafeInteger(offset) || size < 56 || offset + count * size > bytes.length) throw new Error('Invalid ELF program header bounds');
  const loads = [];
  const relros = [];
  for (let index = 0; index < count; index++) {
    const start = offset + index * size;
    const type = bytes.readUInt32LE(start);
    if (type !== 1 && type !== 0x6474e552) continue;
    const address = bytes.readBigUInt64LE(start + 16);
    const segment = { address, end: address + bytes.readBigUInt64LE(start + 40), writable: (bytes.readUInt32LE(start + 4) & 2) !== 0 };
    if (type === 1) {
      if (bytes.readBigUInt64LE(start + 48) < 16384n) throw new Error('Native LOAD segment is not 16 KB aligned');
      loads.push(segment);
    } else {
      relros.push(segment);
    }
  }
  if (!loads.length) throw new Error('ELF library has no LOAD segments');
  for (const relro of relros) {
    if (relro.end % 16384n !== 0n && loads.some((load) => load.writable && load.address <= relro.address && load.end > relro.end)) {
      throw new Error('GNU_RELRO end is not 16 KB aligned and shares a LOAD with trailing writable memory');
    }
  }
  return loads.length;
}

function validateBundleConfig(contents) {
  let config;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new Error('Invalid bundletool config JSON');
  }
  const libraries = config?.optimizations?.uncompressNativeLibraries;
  if (libraries?.enabled !== true || libraries.alignment !== 'PAGE_ALIGNMENT_16K') throw new Error('Bundle native-library alignment must explicitly be PAGE_ALIGNMENT_16K with uncompressed libraries enabled');
  return libraries.alignment;
}

module.exports = { readReleaseEnvironment, prepareSigning, validateApkMetadata, validateMergedReleaseManifest, findMergedReleaseManifest, validateElfAlignment, validateBundleConfig };

if (require.main === module) {
  try {
    const result = prepareSigning(process.env, process.env.PF_ANDROID_KEYSTORE_PATH);
    console.log(result.versionCode);
  } catch (error) {
    // Messages contain variable names and filesystem paths, never secret values.
    console.error(error.message);
    process.exitCode = 1;
  }
}
