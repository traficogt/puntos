import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const library = new URL('../scripts/android-local-lib.mjs', import.meta.url);
async function load() {
  assert.ok(fs.existsSync(library), 'Local Android launcher library is required');
  return import(library.href);
}

test('manual build requires an explicit canonical Play version and accepts only documented options', async () => {
  const { parseArguments } = await load();
  assert.equal(parseArguments(['doctor']).command, 'doctor');
  assert.equal(parseArguments(['setup']).stateDirectory, '/var/lib/puntos/android-builder');
  assert.equal(parseArguments(['build', '--version-code', '13']).versionCode, 13);
  assert.equal(parseArguments(['build', '--version-code', '2100000000']).versionCode, 2100000000);
  assert.equal(parseArguments(['doctor']).keyAlias, 'pf-upload');
  for (const value of ['', '0', '-1', '1.5', '1e3', ' 13 ', '2100000001']) {
    assert.throws(() => parseArguments(['build', '--version-code', value]), /version/i);
  }
  for (const args of [[], ['publish'], ['build'], ['setup', '--version-code', '13'], ['doctor', '--password', 'secret'], ['doctor', '--state-dir'], ['doctor', '--state-dir', './relative'], ['doctor', '--key-alias', 'androiddebugkey'], ['build', '--version-code', '13', '--version-code', '14']]) {
    assert.throws(() => parseArguments(args));
  }
});

type Call = { command: string; args: string[] };
function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-local-test-'));
  const appRoot = path.join(temporary, 'app');
  const stateDirectory = path.join(temporary, 'state');
  const credentials = path.join(temporary, 'credentials');
  fs.mkdirSync(appRoot, { mode: 0o700 });
  fs.mkdirSync(credentials, { mode: 0o700 });
  const keystore = path.join(credentials, 'pf-upload.p12');
  const passwordFile = path.join(credentials, 'pf-upload.password');
  fs.writeFileSync(keystore, 'fixture-private-keystore', { mode: 0o600 });
  fs.writeFileSync(passwordFile, 'fixture-private-password\n', { mode: 0o600 });
  fs.writeFileSync(path.join(appRoot, 'package.json'), '{"version":"0.1.0"}');
  fs.writeFileSync(path.join(appRoot, 'package-lock.json'), '{}');
  fs.mkdirSync(path.join(appRoot, 'src'));
  fs.writeFileSync(path.join(appRoot, 'src/main.ts'), 'export const example = true;\n');
  const calls: Call[] = [];
  const runtime = {
    platform: 'linux',
    appRoot,
    repositoryRoot: appRoot,
    hostLock: path.join(temporary, 'host-operation.lock'),
    availableMemory: () => 6 * 1024 ** 3,
    freeDisk: (_filename: string) => 30 * 1024 ** 3,
    runner: async (command: string, args: string[], _options?: any) => {
      calls.push({ command, args });
      if (args[0] === 'info') return { code: 0, stdout: JSON.stringify({ DockerRootDir: temporary }) };
      if (args[0] === 'image') return { code: 0, stdout: 'sha256:fixture-image\n' };
      return { code: 0, stdout: '' };
    },
  };
  const options = { command: 'build', versionCode: 13, stateDirectory, keystore, passwordFile, keyAlias: 'pf-upload' };
  return { temporary, appRoot, stateDirectory, keystore, passwordFile, runtime, calls, options, cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }) };
}

test('doctor is read-only and reports insufficient storage before any setup or download', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    const result = await runLocalAndroid({ ...f.options, command: 'doctor', versionCode: undefined }, { ...f.runtime, freeDisk: () => 1.6 * 1024 ** 3 });
    assert.equal(result.ready, false);
    assert.match(JSON.stringify(result), /25 GiB.*storage|storage.*25 GiB/i);
    assert.equal(fs.existsSync(f.stateDirectory), false);
    assert.ok(f.calls.every((call) => ['info', 'image'].includes(call.args[0])));
    await assert.rejects(runLocalAndroid({ ...f.options, command: 'setup', versionCode: undefined }, { ...f.runtime, freeDisk: () => 1.6 * 1024 ** 3 }), /25 GiB/);
    assert.equal(fs.existsSync(f.stateDirectory), false);
  } finally { f.cleanup(); }
});

function mounted(args: string[], target: string) {
  const value = args.find((arg) => arg.startsWith('type=bind,') && arg.includes(`,dst=${target}`));
  assert.ok(value, `Expected mount ${target}`);
  return value.split(',').find((item) => item.startsWith('src='))!.slice(4);
}

function writeArtifacts(directory: string, version = 13) {
  fs.writeFileSync(path.join(directory, `PuntosFieles-${version}.apk`), 'validated fixture apk');
  fs.writeFileSync(path.join(directory, `PuntosFieles-${version}.aab`), 'validated fixture aab');
  fs.writeFileSync(path.join(directory, 'apk-signature-report.txt'), 'Signer #1 certificate SHA-256 digest: fixture\n');
  fs.writeFileSync(path.join(directory, 'aab-signature-report.txt'), 'jar verified.\n');
  fs.writeFileSync(path.join(directory, 'bundle-config-report.json'), '{"optimizations":{"uncompressNativeLibraries":{"enabled":true,"alignment":"PAGE_ALIGNMENT_16K"}}}');
  fs.writeFileSync(path.join(directory, 'android-validation-report.json'), JSON.stringify({ package: 'com.puntosfieles.customer', versionCode: version, targetSdk: 36, zipAligned16KB: true, bundleAlignment: 'PAGE_ALIGNMENT_16K', relroChecked16KB: true, libraries: [{ archive: 'app-release.apk', library: 'lib/arm64-v8a/example.so', loadSegments: 1 }] }));
}

test('setup builds only the toolchain context and uses bounded private cache mounts without signing files', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.appRoot, 'tools/android'), { recursive: true });
    await runLocalAndroid({ ...f.options, command: 'setup', versionCode: undefined }, f.runtime);
    const imageBuild = f.calls.find((call) => call.args[0] === 'build')!;
    assert.ok(imageBuild);
    assert.equal(imageBuild.args.at(-1), path.join(f.appRoot, 'tools/android'));
    const setup = f.calls.find((call) => call.args[0] === 'run')!;
    assert.equal(setup.args.at(-1), 'setup');
    for (const flag of ['--cpus=1', '--memory=4g', '--memory-swap=4g', '--pids-limit=512', '--cap-drop=ALL', '--security-opt=no-new-privileges']) assert.ok(setup.args.includes(flag));
    assert.ok(setup.args.includes(`${process.getuid!()}:${process.getgid!()}`));
    assert.equal(mounted(setup.args, '/opt/android-sdk'), path.join(f.stateDirectory, 'sdk'));
    assert.doesNotMatch(JSON.stringify(setup), /run\/secrets|privileged|docker\.sock|network=host|fixture-private/);
    assert.equal(fs.statSync(f.stateDirectory).mode & 0o777, 0o700);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
  } finally { f.cleanup(); }
});

test('private signing files, source boundaries, and symlink paths fail closed before Docker runs', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.chmodSync(f.passwordFile, 0o644);
    await assert.rejects(runLocalAndroid(f.options, f.runtime), /private|permissions/i);
    fs.chmodSync(f.passwordFile, 0o600);
    const link = path.join(f.temporary, 'password-link');
    fs.symlinkSync(f.passwordFile, link);
    await assert.rejects(runLocalAndroid({ ...f.options, passwordFile: link }, f.runtime), /symlink/i);
    await assert.rejects(runLocalAndroid({ ...f.options, stateDirectory: path.join(f.appRoot, 'cache') }, f.runtime), /outside|source|repository/i);
    fs.mkdirSync(f.stateDirectory, { mode: 0o700 });
    fs.symlinkSync(f.temporary, path.join(f.stateDirectory, 'sdk'));
    await assert.rejects(runLocalAndroid(f.options, f.runtime), /symlink/i);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test('Docker storage is checked independently and a missing builder image requires explicit setup', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, freeDisk: (filename: string) => filename === f.temporary ? 1024 ** 3 : 30 * 1024 ** 3 }), /Docker.*25 GiB|25 GiB.*Docker/);
    const runner = f.runtime.runner;
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => args[0] === 'image' ? { code: 1, stdout: '' } : runner(command, args) }), /setup/i);
    assert.ok(f.calls.every((call) => ['info', 'image'].includes(call.args[0])));
  } finally { f.cleanup(); }
});

test('signed build uses an isolated hashed snapshot, read-only signer mounts, and validated output only', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  let work = '';
  try {
    for (const name of ['ios', 'android', 'build', 'dist', '.expo', 'secrets']) {
      fs.mkdirSync(path.join(f.appRoot, name));
      fs.writeFileSync(path.join(f.appRoot, name, 'forbidden.txt'), 'do not copy');
    }
    fs.symlinkSync(f.temporary, path.join(f.appRoot, 'node_modules'));
    for (const name of ['.env.production', '.npmrc', 'upload.p12', 'test.password', 'google-services.json']) fs.writeFileSync(path.join(f.appRoot, name), 'do not copy');
    const runner = f.runtime.runner;
    const result = await runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[], options: any) => {
      const response = await runner(command, args, options);
      if (args[0] === 'run') {
        work = mounted(args, '/work');
        assert.notEqual(work, f.appRoot);
        assert.equal(fs.readFileSync(path.join(work, 'src/main.ts'), 'utf8'), 'export const example = true;\n');
        assert.deepEqual(fs.readdirSync(work).sort(), ['package-lock.json', 'package.json', 'src']);
        assert.ok(args.includes('PF_ANDROID_VERSION_CODE=13'));
        assert.ok(args.includes('PF_ANDROID_KEY_ALIAS=pf-upload'));
        for (const [target, source] of [['/run/secrets/android-upload.p12', f.keystore], ['/run/secrets/android-password', f.passwordFile]]) {
          assert.equal(mounted(args, target), source);
          assert.ok(args.includes(`type=bind,src=${source},dst=${target},readonly`));
        }
        assert.doesNotMatch(JSON.stringify({ args, env: options.env }), /fixture-private|DATABASE|KEYSTORE_BASE64|STORE_PASSWORD|KEY_PASSWORD/);
        writeArtifacts(mounted(args, '/artifacts'));
      }
      return response;
    } });
    assert.equal(fs.existsSync(work), false);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
    assert.equal(result.provenance.versionCode, 13);
    assert.equal(result.provenance.imageId, 'sha256:fixture-image');
    assert.deepEqual(result.provenance.sourceFiles.map((file: any) => file.path), ['package-lock.json', 'package.json', 'src/main.ts']);
    assert.equal(result.provenance.artifacts['PuntosFieles-13.apk'], createHash('sha256').update('validated fixture apk').digest('hex'));
    assert.ok(fs.existsSync(path.join(result.artifactDirectory, 'SHA256SUMS')));
    assert.ok(fs.existsSync(path.join(result.artifactDirectory, 'build-provenance.json')));
    assert.doesNotMatch(JSON.stringify(result.provenance), /fixture-private|password|pf-upload\.p12/);
    assert.equal(fs.readFileSync(path.join(f.appRoot, 'src/main.ts'), 'utf8'), 'export const example = true;\n');
  } finally { f.cleanup(); }
});

test('failed build retains redacted diagnostics but removes partial artifacts, snapshot, and lock', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  let work = '';
  try {
    const runner = f.runtime.runner;
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[], options: any) => {
      const response = await runner(command, args, options);
      if (args[0] === 'run') {
        work = mounted(args, '/work');
        fs.writeFileSync(path.join(mounted(args, '/artifacts'), 'partial.apk'), 'partial');
        options.onOutput('compiler failed\nfixture-private-pass');
        options.onOutput('word\n' + Buffer.from('fixture-private-keystore').toString('base64') + '\n');
        throw new Error('fixture-private-password');
      }
      return response;
    } }), (error: Error) => {
      assert.match(error.message, /failed.*log/i);
      assert.doesNotMatch(error.message, /fixture-private/);
      return true;
    });
    assert.equal(fs.existsSync(work), false);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
    assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'artifacts')), []);
    const logs = fs.readdirSync(path.join(f.stateDirectory, 'logs')).map((filename) => fs.readFileSync(path.join(f.stateDirectory, 'logs', filename), 'utf8')).join('\n');
    assert.match(logs, /compiler failed/);
    assert.doesNotMatch(logs, /fixture-private|Zml4dHVyZS1wcml2YXRlLWtleXN0b3Jl/);
  } finally { f.cleanup(); }
});

test('a second operation cannot enter a running build and never deletes its lock', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(f.stateDirectory, { mode: 0o700 });
    fs.mkdirSync(path.join(f.stateDirectory, 'operation.lock'), { mode: 0o700 });
    await assert.rejects(runLocalAndroid(f.options, f.runtime), /already|lock|running/i);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), true);
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
    assert.ok(f.calls.every((call) => ['info', 'image'].includes(call.args[0])));
  } finally { f.cleanup(); }
});

test('source symlinks and incomplete validation never produce published artifacts', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.symlinkSync(f.passwordFile, path.join(f.appRoot, 'src/leak.txt'));
    await assert.rejects(runLocalAndroid(f.options, f.runtime), /symlink/i);
    fs.unlinkSync(path.join(f.appRoot, 'src/leak.txt'));
    const runner = f.runtime.runner;
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
      const response = await runner(command, args);
      if (args[0] === 'run') writeArtifacts(mounted(args, '/artifacts'), 14);
      return response;
    } }), /validation|artifact/i);
    assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'artifacts')), []);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
  } finally { f.cleanup(); }
});

test('build rejects unsupported hosts and insufficient available RAM without creating state', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, platform: 'darwin' }), /Linux/);
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, availableMemory: () => 4 * 1024 ** 3 }), /4.5 GiB/);
    assert.equal(fs.existsSync(f.stateDirectory), false);
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test('snapshot retains Android build tooling and accepts both existing merged-manifest reports', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.appRoot, 'tools/android'), { recursive: true });
    fs.writeFileSync(path.join(f.appRoot, 'tools/android/entrypoint.sh'), '#!/bin/sh\n');
    const runner = f.runtime.runner;
    const result = await runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
      const response = await runner(command, args);
      if (args[0] === 'run') {
        assert.ok(fs.existsSync(path.join(mounted(args, '/work'), 'tools/android/entrypoint.sh')));
        const output = mounted(args, '/artifacts');
        writeArtifacts(output);
        fs.writeFileSync(path.join(output, 'merged-manifest-report.xml'), '<manifest />\n');
        fs.writeFileSync(path.join(output, 'merged-manifest-validation-report.json'), '{}\n');
      }
      return response;
    } });
    assert.ok(result.provenance.artifacts['merged-manifest-validation-report.json']);
  } finally { f.cleanup(); }
});

test('manual CLI explains commands and rejects missing versions before Docker invocation', () => {
  const cli = new URL('../scripts/android-local.mjs', import.meta.url);
  assert.ok(fs.existsSync(cli), 'Manual Android CLI is required');
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /doctor/);
  assert.match(help.stdout, /build --version-code 13/);
  const build = spawnSync(process.execPath, [cli.pathname, 'build'], { encoding: 'utf8' });
  assert.equal(build.status, 1);
  assert.match(build.stderr, /explicit version/i);
});

test('successful container exit cannot export symlink artifacts or a report containing credentials', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    const runner = f.runtime.runner;
    for (const mutation of ['symlink', 'secret']) {
      await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
        const response = await runner(command, args);
        if (args[0] === 'run') {
          const output = mounted(args, '/artifacts');
          writeArtifacts(output);
          const filename = path.join(output, 'apk-signature-report.txt');
          if (mutation === 'symlink') { fs.unlinkSync(filename); fs.symlinkSync(f.passwordFile, filename); }
          else fs.appendFileSync(filename, 'fixture-private-password');
        }
        return response;
      } }), /Artifact validation failed/);
    }
    assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'artifacts')), []);
  } finally { f.cleanup(); }
});

test('host lock prevents setup and build overlap even with different state directories', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.appRoot, 'tools/android'), { recursive: true });
    const runner = f.runtime.runner;
    for (const command of ['setup', 'build']) {
      const alternateState = path.join(f.temporary, `alternate-${command}`);
      const invocation = { ...f.options, command, versionCode: command === 'build' ? 13 : undefined };
      let protectedPhases = 0;
      await runLocalAndroid(invocation, { ...f.runtime, runner: async (tool: string, args: string[]) => {
        const response = await runner(tool, args);
        if (args[0] === 'build' || args[0] === 'run') {
          assert.ok(fs.existsSync(f.runtime.hostLock), 'Every mutating Docker phase must hold the host lock');
          for (const secondCommand of ['setup', 'build']) {
            await assert.rejects(runLocalAndroid({ ...f.options, command: secondCommand, versionCode: secondCommand === 'build' ? 13 : undefined, stateDirectory: alternateState }, f.runtime), /host.*lock|lock.*host/i);
          }
          assert.equal(fs.existsSync(alternateState), false);
          assert.ok(fs.existsSync(f.runtime.hostLock), 'Rejected contenders cannot remove the active host lock');
          protectedPhases++;
          if (args[0] === 'run' && command === 'build') writeArtifacts(mounted(args, '/artifacts'));
        }
        return response;
      } });
      assert.equal(protectedPhases, command === 'setup' ? 2 : 1);
      assert.equal(fs.existsSync(f.runtime.hostLock), false);
    }
  } finally { f.cleanup(); }
});

test('a failing operation releases the host lock for another state directory', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.appRoot, 'tools/android'), { recursive: true });
    const runner = f.runtime.runner;
    let heldOnFailure = false;
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
      if (args[0] === 'run') {
        heldOnFailure = fs.existsSync(f.runtime.hostLock);
        return { code: 1, stdout: '' };
      }
      return runner(command, args);
    } }), /failed/);
    assert.equal(heldOnFailure, true);
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
    assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
    await runLocalAndroid({ ...f.options, command: 'setup', versionCode: undefined, stateDirectory: path.join(f.temporary, 'another-state') }, f.runtime);
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
  } finally { f.cleanup(); }
});

test('doctor leaves the host lock untouched and setup/build require the VM root operator', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    fs.mkdirSync(f.runtime.hostLock, { mode: 0o700 });
    fs.writeFileSync(path.join(f.runtime.hostLock, 'owner.json'), 'active operator');
    const result = await runLocalAndroid({ ...f.options, command: 'doctor', versionCode: undefined }, f.runtime);
    assert.equal(result.ready, true);
    assert.equal(fs.readFileSync(path.join(f.runtime.hostLock, 'owner.json'), 'utf8'), 'active operator');
    assert.equal(fs.existsSync(f.stateDirectory), false);
    await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, userId: 1000 }), /root/i);
    await assert.rejects(runLocalAndroid({ ...f.options, command: 'setup', versionCode: undefined }, { ...f.runtime, userId: 1000 }), /root/i);
  } finally { f.cleanup(); }
});

test('state cannot overlap the fixed host lock or be deleted with lock cleanup', async () => {
  const { runLocalAndroid } = await load();
  const f = fixture();
  try {
    for (const stateDirectory of [f.runtime.hostLock, path.join(f.runtime.hostLock, 'state')]) {
      await assert.rejects(runLocalAndroid({ ...f.options, stateDirectory }, f.runtime), /overlap|outside.*host.*lock/i);
    }
    assert.equal(fs.existsSync(f.runtime.hostLock), false);
  } finally { f.cleanup(); }
});

test('failed container removal retains workspace and both locks when running, pending, or unknown', async () => {
  const { runLocalAndroid } = await load();
  for (const containerState of ['running', 'created', 'unknown']) {
    const f = fixture();
    let work = '';
    let containerName = '';
    try {
      const runner = f.runtime.runner;
      await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
        if (args[0] === 'run') {
          work = mounted(args, '/work');
          containerName = args[args.indexOf('--name') + 1];
          return { code: 1, stdout: '' };
        }
        if (args[0] === 'rm') return { code: 1, stdout: '', stderr: 'fixture-private-password' };
        if (args[0] === 'container' && args[1] === 'inspect') return containerState !== 'unknown'
          ? { code: 0, stdout: JSON.stringify({ Status: containerState, Running: containerState === 'running', Restarting: false, Paused: false }) }
          : { code: 1, stdout: '' };
        if (args[0] === 'container' && args[1] === 'ls') return containerState !== 'unknown'
          ? { code: 0, stdout: containerName + '\n' }
          : { code: 1, stdout: '' };
        return runner(command, args);
      } }), (error: Error) => {
        assert.match(error.message, /cleanup.*could not be confirmed/i);
        assert.match(error.message, /workspace and locks retained/i);
        assert.doesNotMatch(error.message, /fixture-private/);
        return true;
      });
      assert.ok(fs.existsSync(path.join(work, 'package.json')));
      assert.ok(fs.existsSync(f.runtime.hostLock));
      assert.ok(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')));
      const owner = JSON.parse(fs.readFileSync(path.join(f.runtime.hostLock, 'owner.json'), 'utf8'));
      assert.equal(owner.status, 'cleanup-required');
      const recovery = JSON.parse(fs.readFileSync(owner.recoveryFile, 'utf8'));
      assert.equal(recovery.containerName, containerName);
      assert.equal(recovery.workspace, path.dirname(work));
      assert.equal(recovery.stateLock, path.join(f.stateDirectory, 'operation.lock'));
      assert.equal(recovery.hostLock, f.runtime.hostLock);
      assert.equal(fs.statSync(owner.recoveryFile).mode & 0o777, 0o600);
      assert.doesNotMatch(JSON.stringify(recovery), /fixture-private|password|pf-upload\.p12/);
      assert.deepEqual(fs.readdirSync(path.join(f.stateDirectory, 'artifacts')), []);
      await assert.rejects(runLocalAndroid({ ...f.options, stateDirectory: path.join(f.temporary, 'another-state') }, f.runtime), /host-wide lock/);
    } finally { f.cleanup(); }
  }
});

test('failed container removal permits cleanup only after stopped or absent confirmation', async () => {
  const { runLocalAndroid } = await load();
  for (const containerState of ['stopped', 'absent']) {
    const f = fixture();
    let work = '';
    let inspected = false;
    let absenceChecked = false;
    try {
      const runner = f.runtime.runner;
      await assert.rejects(runLocalAndroid(f.options, { ...f.runtime, runner: async (command: string, args: string[]) => {
        if (args[0] === 'run') { work = mounted(args, '/work'); return { code: 1, stdout: '' }; }
        if (args[0] === 'rm') return { code: 1, stdout: '' };
        if (args[0] === 'container' && args[1] === 'inspect') {
          inspected = true;
          return containerState === 'stopped'
            ? { code: 0, stdout: JSON.stringify({ Status: 'exited', Running: false, Restarting: false, Paused: false }) }
            : { code: 1, stdout: '' };
        }
        if (args[0] === 'container' && args[1] === 'ls') { absenceChecked = true; return { code: 0, stdout: '' }; }
        return runner(command, args);
      } }), /signed Android build failed/);
      assert.equal(inspected, true);
      assert.equal(absenceChecked, containerState === 'absent');
      assert.equal(fs.existsSync(work), false);
      assert.equal(fs.existsSync(f.runtime.hostLock), false);
      assert.equal(fs.existsSync(path.join(f.stateDirectory, 'operation.lock')), false);
    } finally { f.cleanup(); }
  }
});
