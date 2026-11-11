import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { Buffer } from 'node:buffer';

const GiB = 1024 ** 3;
// Host-wide and intentionally unavailable as a CLI or environment override.
// The runtime injection below permits isolated filesystem fixtures in tests.
const HOST_LOCK = '/run/puntos-android-builder.lock';
export const IMAGE = 'puntos-android-builder:20261111-node22-23-5';
const defaults = {
  stateDirectory: '/var/lib/puntos/android-builder',
  keystore: '/var/lib/puntos/credentials/android/pf-upload.p12',
  passwordFile: '/var/lib/puntos/credentials/android/pf-upload.password',
  keyAlias: 'pf-upload',
};
const flagNames = { '--state-dir': 'stateDirectory', '--keystore': 'keystore', '--password-file': 'passwordFile', '--key-alias': 'keyAlias', '--version-code': 'versionCode' };

function validateOptions(options) {
  if (!['doctor', 'setup', 'build'].includes(options.command)) throw new Error('Expected doctor, setup, or build --version-code NUMBER.');
  if (options.command === 'build') {
    if (!/^[1-9][0-9]*$/.test(String(options.versionCode ?? '')) || Number(options.versionCode) > 2100000000) throw new Error('Build requires an explicit version code from 1 to 2100000000.');
  } else if (options.versionCode !== undefined) throw new Error('Only build accepts a version code.');
  for (const name of ['stateDirectory', 'keystore', 'passwordFile']) {
    if (typeof options[name] !== 'string' || !path.isAbsolute(options[name]) || /[,\r\n\0]/.test(options[name])) throw new Error(`${name} must be an absolute path without commas or control characters.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.keyAlias) || options.keyAlias.toLowerCase() === 'androiddebugkey') throw new Error('Use a non-debug Android key alias.');
  return { ...options, ...(options.versionCode !== undefined ? { versionCode: Number(options.versionCode) } : {}) };
}

export function parseArguments(args) {
  const [command, ...flags] = args;
  const options = { ...defaults, command };
  const seen = new Set();
  for (let index = 0; index < flags.length; index += 2) {
    const name = flagNames[flags[index]];
    if (!name || seen.has(name) || flags[index + 1] === undefined) throw new Error('Unknown, repeated, or incomplete option.');
    seen.add(name);
    options[name] = flags[index + 1];
  }
  return validateOptions(options);
}

function freeDisk(filename) {
  let existing = filename;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const usage = fs.statfsSync(existing);
  return usage.bavail * usage.bsize;
}

function availableMemory() {
  const match = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB$/m);
  if (!match) throw new Error('Cannot determine available Linux RAM.');
  return Number(match[1]) * 1024;
}

function noSymlinks(filename) {
  let current = path.resolve(filename);
  while (true) {
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Symlink paths are forbidden for source, state, and signing files.');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function isInside(parent, filename) {
  const relative = path.relative(path.resolve(parent), path.resolve(filename));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function privateDirectory(filename, create = false) {
  noSymlinks(filename);
  if (!fs.existsSync(filename)) {
    if (!create) return;
    fs.mkdirSync(filename, { recursive: true, mode: 0o700 });
  }
  const stat = fs.statSync(filename);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('Builder state directories must be private and owned by the current user.');
}

function signingFile(filename) {
  noSymlinks(filename);
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0 || stat.size > 16 * 1024 ** 2 || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('Signing files must exist, be nonempty, private (0600 or 0400), and owned by the current user.');
  privateDirectory(path.dirname(filename));
}

function validatePaths(options, runtime) {
  noSymlinks(runtime.appRoot);
  if (isInside(runtime.repositoryRoot, options.stateDirectory) || isInside(options.stateDirectory, runtime.appRoot)) throw new Error('Builder state must be outside the source repository.');
  if (isInside(runtime.hostLock, options.stateDirectory) || isInside(options.stateDirectory, runtime.hostLock)) throw new Error('Builder state must not overlap the host-wide lock directory.');
  for (const directory of ['', 'sdk', 'gradle', 'npm', 'work', 'logs', 'artifacts', 'operation.lock']) privateDirectory(path.join(options.stateDirectory, directory));
  if (options.command !== 'setup') {
    for (const filename of [options.keystore, options.passwordFile]) {
      if (isInside(runtime.repositoryRoot, filename)) throw new Error('Signing files must stay outside the source repository.');
      signingFile(filename);
    }
    if (options.keystore === options.passwordFile) throw new Error('Keystore and password must be separate private files.');
  }
}

// No production environment is forwarded to Docker. HOME is preserved only for
// the Docker client's normal config lookup; it is never assigned in the host.
function dockerEnvironment() {
  return { PATH: process.env.PATH, ...(process.env.HOME ? { HOME: process.env.HOME } : {}), LANG: 'C.UTF-8', DOCKER_HOST: 'unix:///var/run/docker.sock' };
}

function runner(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: options.env, signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      if (options.onOutput) options.onOutput(chunk);
      else if (stdout.length < 1024 ** 2) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => { if (options.onOutput) options.onOutput(chunk); });
    child.on('error', () => resolve({ code: 1, stdout }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function inspectDocker(runtime) {
  let response;
  try { response = await runtime.runner('docker', ['info', '--format', '{{json .}}'], { env: dockerEnvironment(), signal: runtime.signal }); } catch { /* Safe diagnostic below. */ }
  if (response?.code !== 0) throw new Error('Local Docker is unavailable; install/start Docker and check access to its local socket.');
  let info;
  try { info = JSON.parse(response.stdout); } catch { throw new Error('Cannot read local Docker storage information.'); }
  if (!path.isAbsolute(info.DockerRootDir ?? '')) throw new Error('Cannot determine the local Docker storage directory.');
  if (runtime.freeDisk(info.DockerRootDir) < 25 * GiB) throw new Error('Docker storage needs at least 25 GiB free before setup or a build.');
  return info.DockerRootDir;
}

async function inspectImage(runtime) {
  let response;
  try { response = await runtime.runner('docker', ['image', 'inspect', '--format', '{{.Id}}', IMAGE], { env: dockerEnvironment(), signal: runtime.signal }); } catch { /* Safe diagnostic below. */ }
  if (response?.code !== 0 || !response.stdout.trim().startsWith('sha256:')) throw new Error('Builder image is missing; run the explicit setup command after storage is ready.');
  return response.stdout.trim();
}

const excludedDirectories = new Set(['node_modules', '.git', '.expo', '.gradle', '.cache', 'build', 'dist', 'coverage', 'tmp', 'credentials', 'secrets']);
function excludedFile(name) {
  return /^\.env(?:\.|$)/i.test(name) || /^\.(?:npmrc|yarnrc)/i.test(name) || /\.(?:p12|pfx|jks|keystore|pem|key|password|mobileprovision)$/i.test(name) || /^(?:credentials|secrets?|service[-_]account|google-services)(?:[._-]|$)/i.test(name);
}

function snapshot(source, destination) {
  const manifest = [];
  function copy(relative) {
    for (const entry of fs.readdirSync(path.join(source, relative)).sort()) {
      if ((!relative && ['ios', 'android'].includes(entry)) || excludedDirectories.has(entry) || excludedFile(entry)) continue;
      const name = path.join(relative, entry);
      const from = path.join(source, name);
      const to = path.join(destination, name);
      const stat = fs.lstatSync(from);
      if (stat.isSymbolicLink()) throw new Error('Source snapshot rejects symlinks.');
      if (stat.isDirectory()) {
        fs.mkdirSync(to, { mode: 0o700 });
        copy(name);
      } else if (stat.isFile()) {
        const descriptor = fs.openSync(from, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let bytes;
        try { bytes = fs.readFileSync(descriptor); } finally { fs.closeSync(descriptor); }
        fs.writeFileSync(to, bytes, { flag: 'wx', mode: stat.mode & 0o111 ? 0o700 : 0o600 });
        manifest.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error('Source snapshot accepts only regular files and directories.');
    }
  }
  copy('');
  for (const name of ['package.json', 'package-lock.json']) if (!manifest.some((entry) => entry.path === name)) throw new Error('Source snapshot requires package.json and its existing lockfile.');
  return manifest.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function secretTokens(options) {
  if (options.command !== 'build') return [];
  const bytes = fs.readFileSync(options.keystore);
  const password = fs.readFileSync(options.passwordFile, 'utf8').replace(/[\r\n]+$/, '');
  if (!password || /[\r\n\0]/.test(password)) throw new Error('Password file must contain one nonempty password line.');
  return [...new Set([password, Buffer.from(password).toString('base64'), bytes.toString('base64'), bytes.toString('hex'), bytes.toString('utf8')].filter(Boolean))].sort((a, b) => b.length - a.length);
}

function diagnosticLog(filename, tokens) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const tailLength = Math.max(1, ...tokens.map((token) => token.length));
  const redact = (text) => tokens.reduce((result, token) => result.split(token).join('[REDACTED]'), text);
  return {
    redact,
    write(chunk) {
      pending = redact(pending + (Buffer.isBuffer(chunk) ? decoder.write(chunk) : chunk));
      if (pending.length > tailLength) {
        fs.writeSync(descriptor, pending.slice(0, -tailLength));
        pending = pending.slice(-tailLength);
      }
    },
    close() { fs.writeSync(descriptor, redact(pending + decoder.end())); fs.closeSync(descriptor); },
  };
}

function mount(source, target, readonly = false) {
  return ['--mount', `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`];
}

function containerArguments(options, name) {
  return ['run', '--rm', '--name', name, '--user', `${process.getuid()}:${process.getgid()}`, '--cpus=1', '--memory=4g', '--memory-swap=4g', '--pids-limit=512', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    ...mount(path.join(options.stateDirectory, 'sdk'), '/opt/android-sdk'),
    ...mount(path.join(options.stateDirectory, 'gradle'), '/cache/gradle'),
    ...mount(path.join(options.stateDirectory, 'npm'), '/cache/npm')];
}

async function confirmContainerStopped(runtime, name) {
  const settings = { env: dockerEnvironment() };
  // Cleanup must still run after the operation's AbortSignal has fired.
  try {
    const removal = await runtime.runner('docker', ['rm', '--force', name], settings);
    if (removal.code === 0) return true;
  } catch { /* An unreachable daemon does not prove that the container stopped. */ }
  try {
    const inspection = await runtime.runner('docker', ['container', 'inspect', '--format', '{{json .State}}', name], settings);
    if (inspection.code === 0) {
      const state = JSON.parse(inspection.stdout);
      if (state.Running === false && state.Restarting === false && state.Paused === false && ['exited', 'dead'].includes(state.Status)) return true;
    }
  } catch { /* Fall through to an explicit absence check. */ }
  try {
    const listing = await runtime.runner('docker', ['container', 'ls', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], settings);
    return listing.code === 0 && listing.stdout.trim() === '';
  } catch { return false; }
}

function publishArtifacts(staging, destination, provenance, log) {
  const allowed = [`PuntosFieles-${provenance.versionCode}.apk`, `PuntosFieles-${provenance.versionCode}.aab`, 'apk-signature-report.txt', 'aab-signature-report.txt', 'bundle-config-report.json', 'android-validation-report.json'];
  const entries = fs.readdirSync(staging);
  if (allowed.some((name) => !entries.includes(name)) || entries.some((name) => ![...allowed, 'merged-manifest-report.xml', 'merged-manifest-validation-report.json'].includes(name))) throw new Error('Artifact validation failed: incomplete or unexpected output files.');
  const hashes = {};
  for (const name of entries.sort()) {
    const filename = path.join(staging, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size === 0 || stat.nlink !== 1) throw new Error('Artifact validation failed: outputs must be nonempty regular files.');
    const bytes = fs.readFileSync(filename);
    if (!/\.(apk|aab)$/.test(name) && log.redact(bytes.toString('utf8')) !== bytes.toString('utf8')) throw new Error('Artifact validation failed: a report contains signing material.');
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    fs.chmodSync(filename, 0o600);
  }
  const report = JSON.parse(fs.readFileSync(path.join(staging, 'android-validation-report.json'), 'utf8'));
  if (report.package !== 'com.puntosfieles.customer' || report.versionCode !== provenance.versionCode || report.targetSdk < 36 || report.zipAligned16KB !== true || report.relroChecked16KB !== true || report.bundleAlignment !== 'PAGE_ALIGNMENT_16K' || !report.libraries?.length) throw new Error('Artifact validation report does not match the requested build.');
  provenance.artifacts = hashes;
  fs.writeFileSync(path.join(staging, 'SHA256SUMS'), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}\n`).join(''), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(staging, 'build-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(staging, destination);
}

export async function runLocalAndroid(input, injected = {}) {
  const options = validateOptions({ ...defaults, ...input });
  const appRoot = fileURLToPath(new URL('..', import.meta.url));
  const runtime = { platform: process.platform, userId: process.getuid?.(), hostLock: HOST_LOCK, appRoot, repositoryRoot: path.resolve(appRoot, '../..'), freeDisk, availableMemory, runner, ...injected };
  const issues = [];
  if (runtime.platform !== 'linux') issues.push('The local Android builder requires Linux.');
  if (options.command !== 'doctor' && runtime.userId !== 0) issues.push('Setup and build require the VM root operator to use the host-wide /run/puntos-android-builder.lock.');
  if (runtime.freeDisk(options.stateDirectory) < 25 * GiB) issues.push('At least 25 GiB of free storage is required; expand storage or select another build host before setup.');
  if (runtime.platform === 'linux' && runtime.availableMemory() < 4.5 * GiB) issues.push('At least 4.5 GiB of available RAM is required before a build.');
  if (options.command === 'doctor') {
    for (const check of [() => validatePaths(options, runtime), () => inspectDocker(runtime), () => inspectImage(runtime)]) {
      try { await check(); } catch (error) { issues.push(error.message); }
    }
    return { ready: issues.length === 0, image: IMAGE, stateDirectory: options.stateDirectory, issues };
  }
  if (issues.length) throw new Error(issues.join('\n'));
  validatePaths(options, runtime);
  await inspectDocker(runtime);
  const imageId = options.command === 'build' ? await inspectImage(runtime) : undefined;
  const tokens = secretTokens(options);
  noSymlinks(runtime.hostLock);
  try { fs.mkdirSync(runtime.hostLock, { mode: 0o700 }); }
  catch { throw new Error('Another local Android operation holds the host-wide lock; inspect /run/puntos-android-builder.lock before removing a stale lock.'); }
  const lock = path.join(options.stateDirectory, 'operation.lock');
  let stateLockHeld = false;
  let work;
  let log;
  let logFile;
  let container;
  let phase = 'preparation';
  let containerStarted = false;
  let containerCompleted = false;
  try {
    fs.writeFileSync(path.join(runtime.hostLock, 'owner.json'), JSON.stringify({ pid: process.pid, command: options.command, stateDirectory: options.stateDirectory, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    privateDirectory(options.stateDirectory, true);
    try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Another local Android operation holds the state lock; inspect it before removing a stale lock.'); }
    stateLockHeld = true;
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, command: options.command, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
    for (const name of ['sdk', 'gradle', 'npm', 'work', 'logs', 'artifacts']) privateDirectory(path.join(options.stateDirectory, name), true);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    container = `pf-android-${id.toLowerCase()}`;
    logFile = path.join(options.stateDirectory, 'logs', `${options.command}-${id}.log`);
    log = diagnosticLog(logFile, tokens);
    const execute = async (args, label) => {
      phase = label;
      log.write(`Starting ${label}.\n`);
      let response;
      try { response = await runtime.runner('docker', args, { env: dockerEnvironment(), signal: runtime.signal, onOutput: (chunk) => log.write(chunk) }); }
      catch { throw new Error(`Docker ${label} failed; see private log: ${logFile}`); }
      if (response.stdout) log.write(response.stdout);
      if (response.stderr) log.write(response.stderr);
      if (response.code !== 0) throw new Error(`Docker ${label} failed (exit ${response.code}); see private log: ${logFile}`);
      log.write(`Completed ${label}.\n`);
    };
    if (options.command === 'setup') {
      const context = path.join(runtime.appRoot, 'tools/android');
      noSymlinks(context);
      if (!fs.statSync(context).isDirectory()) throw new Error('Android toolchain context is missing.');
      await execute(['build', '--tag', IMAGE, context], 'toolchain image setup');
      containerStarted = true;
      await execute([...containerArguments(options, container), IMAGE, 'setup'], 'SDK setup');
      containerCompleted = true;
      return { ready: true, image: IMAGE, logFile };
    }
    work = fs.mkdtempSync(path.join(options.stateDirectory, 'work', 'build-'));
    const source = path.join(work, 'app');
    const staging = path.join(work, 'artifacts');
    fs.mkdirSync(source, { mode: 0o700 });
    fs.mkdirSync(staging, { mode: 0o700 });
    const sourceFiles = snapshot(runtime.appRoot, source);
    const args = [...containerArguments(options, container), ...mount(source, '/work'), ...mount(staging, '/artifacts'),
      ...mount(options.keystore, '/run/secrets/android-upload.p12', true), ...mount(options.passwordFile, '/run/secrets/android-password', true),
      '--env', `PF_ANDROID_VERSION_CODE=${options.versionCode}`, '--env', `PF_ANDROID_KEY_ALIAS=${options.keyAlias}`, imageId, 'build'];
    const startedAt = new Date().toISOString();
    containerStarted = true;
    await execute(args, 'signed Android build');
    containerCompleted = true;
    phase = 'artifact validation';
    const provenance = { package: 'com.puntosfieles.customer', versionName: JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version, versionCode: options.versionCode, image: IMAGE, imageId, startedAt, finishedAt: new Date().toISOString(), sourceFiles, sourceManifestSha256: createHash('sha256').update(JSON.stringify(sourceFiles)).digest('hex') };
    const artifactDirectory = path.join(options.stateDirectory, 'artifacts', id);
    publishArtifacts(staging, artifactDirectory, provenance, log);
    log.write('Validated artifacts saved. No upload was requested or performed.\n');
    return { artifactDirectory, provenance, logFile };
  } finally {
    if (containerStarted && !containerCompleted && !await confirmContainerStopped(runtime, container)) {
      // The container may still hold these mounts. Preserve its workspace and
      // both locks until an operator verifies it is stopped or absent.
      const recoveryFile = `${logFile}.recovery.json`;
      const recovery = { status: 'cleanup-required', pid: process.pid, command: options.command, phase, containerName: container, workspace: work ?? null, stateDirectory: options.stateDirectory, hostLock: runtime.hostLock, stateLock: lock, logFile, recoveryFile, recordedAt: new Date().toISOString() };
      let recorded = false;
      try {
        fs.writeFileSync(recoveryFile, JSON.stringify(recovery, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        recorded = true;
        for (const directory of [runtime.hostLock, lock]) fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(recovery) + '\n', { mode: 0o600 });
      } catch { /* Keep the locks even if diagnostics cannot be persisted. */ }
      try {
        log.write('Container cleanup could not be confirmed. Workspace and both locks retained for operator recovery.\n');
        log.close();
      } catch { /* A diagnostic write error cannot make releasing mounts safe. */ }
      throw new Error(`Android container cleanup could not be confirmed. Workspace and locks retained; ${recorded ? `inspect recovery metadata: ${recoveryFile}` : `recovery metadata could not be written; inspect container ${container} and private log ${logFile}`}. Confirm the container is stopped or absent before removing retained state.`);
    }
    try {
      if (log) { log.write(`Operation ended during ${phase}.\n`); log.close(); }
    } finally {
      try {
        if (work) fs.rmSync(work, { recursive: true, force: true });
      } finally {
        try {
          if (stateLockHeld) fs.rmSync(lock, { recursive: true, force: true });
        } finally {
          fs.rmSync(runtime.hostLock, { recursive: true, force: true });
        }
      }
    }
  }
}
