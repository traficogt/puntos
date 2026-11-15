/* eslint-disable security/detect-non-literal-fs-filename -- All paths belong to newly-created temporary test fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as readiness from '../../src/scripts/release-readiness-lib.mjs';

test('release readiness exposes evidence validation instead of trusting status claims', () => {
  assert.equal(typeof readiness?.evaluateEvidence, 'function');
});

const tap = 'TAP version 13\n# Subtest: fixture\nok 1 - fixture\n  ---\n  duration_ms: 0.1\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 12.1\n';
const playwright = JSON.stringify({ errors: [], suites: [{ specs: [{ tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }] }] }], stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 } });
const domain = JSON.stringify({ file: 'fixture.test.js', exit: 0, tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0, ok: true }) + '\n' + JSON.stringify({ suites: 1, expectedSuites: 1, tests: 1, pass: 1, failedSuites: 0 });

test('Node TAP requires complete counts and rejects missing, duplicate, skipped and failed results', () => {
  assert.equal(readiness?.parseTap(tap).pass, 1);
  for (const value of ['', '# tests 1\n# pass 1', tap.replace('# pass 1', '# pass 0'), tap + '# tests 1\n', tap.replace('# skipped 0', '# skipped 1'), tap.replace('ok 1', 'not ok 1')]) {
    assert.notEqual(readiness?.parseTap(value)?.valid && readiness?.parseTap(value)?.pass === readiness?.parseTap(value)?.tests, true);
  }
});

test('Playwright requires individual executed results and rejects retries, skips, errors and summary-only evidence', () => {
  assert.equal(readiness?.parsePlaywright(playwright).pass, 1);
  const report = JSON.parse(playwright);
  report.suites[0].specs[0].tests[0].results = [{ status: 'failed' }, { status: 'passed' }];
  assert.equal(readiness?.parsePlaywright(JSON.stringify(report)).pass, 0);
  assert.equal(readiness?.parsePlaywright(JSON.stringify({ stats: JSON.parse(playwright).stats })).valid, false);
  report.suites[0].specs[0].tests[0].results = [{ status: 'skipped' }];
  assert.equal(readiness?.parsePlaywright(JSON.stringify(report)).skipped, 1);
  report.errors = [{ message: 'private-value' }];
  assert.equal(readiness?.parsePlaywright(JSON.stringify(report)).valid, false);
});

test('domain JSONL requires every expected suite and matching final totals', () => {
  assert.equal(readiness?.parseDomains(domain, ['fixture.test.js']).pass, 1);
  assert.equal(readiness?.parseDomains(domain, ['fixture.test.js', 'missing.test.js']).valid, false);
  assert.equal(readiness?.parseDomains(domain.replace('"pass":1', '"pass":0'), ['fixture.test.js']).valid, false);
  assert.equal(readiness?.parseDomains(domain + '\n' + domain, ['fixture.test.js']).valid, false);
});

const source = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), contentSha256: 'c'.repeat(64), clean: true, trackedFiles: 1, untrackedFiles: 0, dirtyEntries: 0 };
const check = { id: 'fixture', title: 'Fixture tests', category: 'functional', command: ['node', '--test', 'fixture.test.js'], format: 'tap', timeoutMs: 1000 };
const now = new Date('2026-11-15T12:00:00.000Z');
function evidence() {
  const stdout = Buffer.from(tap), stderr = Buffer.from('private email person@example.com token=private-token');
  return { check, source, revision: source.commit, now, stdout, stderr, receipt: {
    schemaVersion: 1, checkId: check.id, command: check.command, sourceBefore: source, sourceAfter: source,
    startedAt: '2026-11-15T11:59:00.000Z', finishedAt: '2026-11-15T11:59:01.000Z', durationMs: 1000,
    exitCode: 0, signal: null, timedOut: false, truncated: false, cancelled: false,
    toolVersions: { node: process.version },
    artifacts: { stdout: { sha256: readiness?.digest(stdout), bytes: stdout.length }, stderr: { sha256: readiness?.digest(stderr), bytes: stderr.length } }
  } };
}

test('evidence is bound to content, revision, time, command, exit and real reporter bytes', () => {
  assert.equal(readiness?.evaluateEvidence(evidence()).status, 'passed');
  for (const change of [
    value => { value.receipt.sourceBefore = { ...source, commit: 'd'.repeat(40) }; },
    value => { value.receipt.sourceAfter = { ...source, contentSha256: 'd'.repeat(64) }; },
    value => { value.source = { ...source, clean: false }; },
    value => { value.receipt.startedAt = '2026-11-13T11:59:00.000Z'; },
    value => { value.receipt.finishedAt = '2026-11-16T11:59:00.000Z'; },
    value => { value.receipt.command = ['sh', '-c', 'touch /tmp/never-execute']; },
    value => { value.receipt.exitCode = 1; },
    value => { value.receipt.signal = 'SIGTERM'; },
    value => { value.receipt.timedOut = true; },
    value => { value.receipt.cancelled = true; },
    value => { value.receipt.truncated = true; },
    value => { value.stdout = Buffer.from(tap + 'changed'); },
    value => { value.receipt.artifacts = {}; },
    value => { delete value.receipt.exitCode; }
  ]) {
    const value = evidence(); change(value);
    assert.notEqual(readiness?.evaluateEvidence(value).status, 'passed');
  }
});

test('summary-only self-attestations cannot stand in for missing artifacts', () => {
  const value = evidence();
  value.receipt.status = 'passed'; value.receipt.counts = { tests: 400, pass: 400 };
  value.stdout = Buffer.from('');
  assert.notEqual(readiness?.evaluateEvidence(value).status, 'passed');
  assert.equal(readiness?.evaluateEvidence({ ...value, receipt: null }).status, 'not_tested');
});

test('public result fields never copy raw errors, environment values or test names', () => {
  const value = evidence();
  value.receipt.extra = { env: { SECRET: 'private-token' } };
  const result = JSON.stringify(readiness?.evaluateEvidence(value));
  assert.doesNotMatch(result, /private-token|person@example.com|"env"|"extra"/);
  assert.match(result, /sha256/);
});

import { mkdtemp, writeFile, readFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

async function fixtureDirectory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'readiness-fixture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixtureRepo(t) {
  const dir = await fixtureDirectory(t);
  execFileSync('git', ['init', '-q', dir]);
  await writeFile(join(dir, 'fixture.txt'), 'initial\n');
  execFileSync('git', ['add', 'fixture.txt'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: dir });
  return dir;
}

test('source identity detects modified, untracked and executable-mode content', async t => {
  const dir = await fixtureRepo(t);
  const before = await readiness?.inspectSource(dir);
  assert.equal(before?.clean, true);
  await writeFile(join(dir, 'fixture.txt'), 'modified\n');
  const modified = await readiness.inspectSource(dir);
  assert.equal(modified.clean, false);
  assert.notEqual(modified.contentSha256, before.contentSha256);
  await writeFile(join(dir, 'fixture.txt'), 'initial\n');
  await chmod(join(dir, 'fixture.txt'), 0o755);
  assert.notEqual((await readiness.inspectSource(dir)).contentSha256, before.contentSha256);
  await chmod(join(dir, 'fixture.txt'), 0o644);
  await writeFile(join(dir, 'new.txt'), 'untracked');
  assert.equal((await readiness.inspectSource(dir)).untrackedFiles, 1);
});

test('bounded subprocess capture reads real Node TAP and records nonzero exit, timeout and missing tools', async t => {
  const dir = await fixtureDirectory(t);
  await writeFile(join(dir, 'fixture.test.mjs'), "import test from 'node:test'; test('fixture', () => {});\n");
  const options = { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 3000 };
  const passed = await readiness?.capture(process.execPath, ['--test', '--test-reporter=tap', 'fixture.test.mjs'], options);
  assert.equal(passed?.exitCode, 0);
  assert.equal(readiness.parseTap(passed.stdout.toString()).pass, 1);
  const failed = await readiness.capture(process.execPath, ['-e', 'process.exit(7)'], options);
  assert.equal(failed.exitCode, 7);
  const timeout = await readiness.capture(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeoutMs: 100 });
  assert.equal(timeout.timedOut, true);
  const missing = await readiness.capture('/nonexistent/readiness-fixture-tool', [], options);
  assert.equal(missing.exitCode, 127);
  const bounded = await readiness.capture(process.execPath, ['-e', "process.stdout.write('x'.repeat(10000))"], { ...options, maxBytes: 100 });
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.stdout.length <= 100);
});

test('fresh runs write private artifacts and changing source cannot produce passing evidence', async t => {
  const dir = await fixtureRepo(t), output = await fixtureDirectory(t);
  const before = await readiness?.inspectSource(dir);
  const fixtureCheck = { ...check, command: ['node', '-e', "console.log('private-token');"], format: 'exit' };
  const run = await readiness?.executeCheck(fixtureCheck, { cwd: dir, output, env: { PATH: process.env.PATH } });
  assert.equal(run?.receipt?.exitCode, 0);
  assert.equal(readiness.evaluateEvidence({ ...run, check: fixtureCheck, source: before, revision: before.commit }).status, 'passed');
  assert.equal((await stat(join(output, 'fixture.stdout'))).mode & 0o777, 0o600);
  const mutation = { ...fixtureCheck, command: ['node', '-e', "require('node:fs').writeFileSync('fixture.txt', 'changed')"] };
  const changed = await readiness.executeCheck(mutation, { cwd: dir, output: await fixtureDirectory(t), env: { PATH: process.env.PATH } });
  assert.notEqual(readiness.evaluateEvidence({ ...changed, check: mutation, source: before, revision: before.commit }).status, 'passed');
});

test('code readiness remains separate from external physical, provider and security acceptance', () => {
  const result = readiness?.evaluateEvidence(evidence());
  const report = readiness?.buildReport({ source, revision: source.commit, results: [result], generatedAt: now.toISOString() });
  assert.equal(report?.codeReadiness, 'passed');
  assert.equal(report.pilotReadiness, 'not_tested');
  assert.ok(report.checks.filter(row => row.category === 'external').length >= 3);
  assert.ok(report.checks.filter(row => row.category === 'external').every(row => row.status === 'not_tested'));
  const markdown = readiness.renderMarkdown(report);
  assert.match(markdown, /Code readiness: passed/);
  assert.match(markdown, /Pilot readiness: not_tested/);
  assert.doesNotMatch(markdown, /private-token|person@example.com/);
});

test('a failed wrapper without observed tests is not tested, and executed skipped tests cannot pass', () => {
  const value = evidence();
  value.stdout = Buffer.from('');
  value.receipt.artifacts.stdout = { sha256: readiness.digest(value.stdout), bytes: 0 };
  value.receipt.exitCode = 127;
  assert.equal(readiness.evaluateEvidence(value).status, 'not_tested');
  const skipped = evidence();
  skipped.stdout = Buffer.from(tap.replace('# pass 1', '# pass 0').replace('# skipped 0', '# skipped 1').replace('ok 1 - fixture', 'ok 1 - fixture # SKIP'));
  skipped.receipt.artifacts.stdout = { sha256: readiness.digest(skipped.stdout), bytes: skipped.stdout.length };
  assert.equal(readiness.evaluateEvidence(skipped).status, 'failed');
});

test('tool package versions are preserved without arbitrary receipt fields', () => {
  const value = evidence();
  value.check = { ...check, tools: { playwright: 'node_modules/playwright/package.json' } };
  value.receipt.toolVersions.playwright = '1.65.0';
  value.receipt.toolVersions.secret = 'private-token';
  const result = readiness.evaluateEvidence(value);
  assert.equal(result.toolVersions.playwright, '1.65.0');
  assert.equal(result.toolVersions.secret, undefined);
});

import { fileURLToPath } from 'node:url';
const cliPath = fileURLToPath(new URL('../../src/scripts/release-readiness.mjs', import.meta.url));

test('CLI runs fixed static check, emits JSON and Markdown, and leaves omitted/external gates untested', async t => {
  const dir = await fixtureRepo(t), outside = await fixtureDirectory(t);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { 'test:integration:core': 'NODE_ENV=test node --test --test-concurrency=1 tests/integration/fixture.test.js' } }));
  await writeFile(join(dir, '.gitignore'), 'node_modules\n');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'src/scripts'), { recursive: true });
  await writeFile(join(dir, 'src/scripts/release-checklist.mjs'), "console.log('static fixture only');");
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture checklist'], { cwd: dir });
  const identity = await readiness.inspectSource(dir);
  const output = join(outside, 'report');
  const result = await readiness.capture(process.execPath, [cliPath, '--revision', identity.commit, '--output', output, '--run', 'static'],
    { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 10000 });
  assert.equal(result.exitCode, 2, result.stderr.toString());
  const report = JSON.parse(await readFile(join(output, 'readiness.json'), 'utf8'));
  assert.equal(report.checks.find(row => row.id === 'static').status, 'passed');
  assert.equal(report.checks.find(row => row.id === 'unit').status, 'not_tested');
  assert.equal(report.codeReadiness, 'not_tested');
  assert.equal(report.pilotReadiness, 'not_tested');
  assert.match(await readFile(join(output, 'readiness.md'), 'utf8'), /static/);
  assert.equal(report.source.commit, identity.commit);
  const rejected = await readiness.capture(process.execPath, [cliPath, '--revision', identity.commit, '--output', join(outside, 'invalid'), '--evidence', output],
    { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 3000 });
  assert.equal(rejected.exitCode, 1);
  const dirty = await readiness.capture(process.execPath, [cliPath, '--revision', 'e'.repeat(40), '--output', join(outside, 'mismatch'), '--run', 'static'],
    { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 3000 });
  assert.equal(dirty.exitCode, 1);
  const mismatch = JSON.parse(await readFile(join(outside, 'mismatch/readiness.json'), 'utf8'));
  assert.equal(mismatch.checks.find(row => row.id === 'static').status, 'not_tested');
});

test('TAP summary without observed results cannot certify a test run', () => {
  const summaryOnly = tap.replace(/# Subtest: fixture\nok 1 - fixture\n  ---\n  duration_ms: 0.1\n  ...\n/, '');
  assert.equal(readiness.parseTap(summaryOnly).valid, false);
});

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);

test('parser accepts actual installed Playwright JSON and rejects its skipped test result', async t => {
  const dir = await fixtureDirectory(t);
  const testModule = pathToFileURL(require.resolve('@playwright/test').replace(/index\.js$/, 'index.mjs')).href;
  await writeFile(join(dir, 'playwright.config.mjs'), 'export default { testDir: ".", workers: 1, retries: 0, reporter: "json" };');
  await writeFile(join(dir, 'reporter.spec.mjs'), `import {test, expect} from ${JSON.stringify(testModule)}; test('fixture', () => { expect(1).toBe(1); });`);
  const args = [require.resolve('@playwright/test/cli'), 'test', '--config', join(dir, 'playwright.config.mjs'), '--output', join(dir, 'results')];
  const result = await readiness.capture(process.execPath, args, { cwd: dir, env: { PATH: process.env.PATH, TMPDIR: dir, HOME: dir }, timeoutMs: 15000 });
  assert.equal(result.exitCode, 0, result.stderr.toString() + result.stdout.toString());
  const counts = readiness.parsePlaywright(result.stdout.toString(), ['reporter.spec.mjs']);
  assert.equal(counts.valid, true);
  assert.equal(counts.pass, 1);
  await writeFile(join(dir, 'reporter.spec.mjs'), `import {test} from ${JSON.stringify(testModule)}; test.skip('fixture', () => {});`);
  const skipped = await readiness.capture(process.execPath, args, { cwd: dir, env: { PATH: process.env.PATH, TMPDIR: dir, HOME: dir }, timeoutMs: 15000 });
  assert.equal(skipped.exitCode, 0);
  assert.equal(readiness.parsePlaywright(skipped.stdout.toString()).skipped, 1);
});

test('mismatched source keeps safe observed execution metadata without passing', () => {
  const value = evidence();
  value.receipt.sourceAfter = { ...source, contentSha256: 'd'.repeat(64) };
  const result = readiness.evaluateEvidence(value);
  assert.equal(result.status, 'not_tested');
  assert.equal(result.exitCode, 0);
  assert.equal(result.counts.tests, 1);
  assert.equal(result.artifacts.stdout.sha256, readiness.digest(value.stdout));
});

test('Git assume-unchanged cannot hide source bytes that differ from the recorded commit', async t => {
  const dir = await fixtureRepo(t);
  execFileSync('git', ['update-index', '--assume-unchanged', 'fixture.txt'], { cwd: dir });
  await writeFile(join(dir, 'fixture.txt'), 'hidden modification');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), '');
  assert.equal((await readiness.inspectSource(dir)).clean, false);
});

test('capture records cancellation even when SIGTERM is handled with exit zero', async t => {
  const dir = await fixtureDirectory(t), abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 150);
  t.after(() => clearTimeout(timer));
  const result = await readiness.capture(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],
    { cwd: dir, env: { PATH: process.env.PATH }, timeoutMs: 3000, signal: abort.signal });
  assert.equal(result.exitCode, 0);
  assert.equal(result.cancelled, true);
});

test('fixed production build environment overrides the general test default', async t => {
  const dir = await fixtureRepo(t), output = await fixtureDirectory(t);
  const build = { ...check, command: ['node', '-e', 'console.log(process.env.NODE_ENV)'], format: 'exit', env: { NODE_ENV: 'production' } };
  const result = await readiness.executeCheck(build, { cwd: dir, output, env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
  assert.equal(result.stdout.toString().trim(), 'production');
});

test('Playwright must observe every fixed required spec file', () => {
  const report = JSON.parse(playwright);
  report.suites[0].specs[0].file = 'one.spec.js';
  assert.equal(readiness.parsePlaywright(JSON.stringify(report), ['one.spec.js', 'missing.spec.js']).valid, false);
  assert.equal(readiness.parsePlaywright(JSON.stringify(report), ['one.spec.js']).valid, true);
});

import { createServer } from 'node:http';
import { once } from 'node:events';
test('browser application revision must match before and after execution', async t => {
  const dir = await fixtureRepo(t), output = await fixtureDirectory(t);
  const identity = await readiness.inspectSource(dir);
  let hits = 0;
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ build_sha: ++hits === 1 ? identity.commit : 'e'.repeat(40) }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => resolve(undefined))));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const target = `http://127.0.0.1:${address.port}`;
  const appCheck = { ...check, requiresApplicationIdentity: true, command: ['node', '-e', `process.stdout.write(${JSON.stringify(tap)})`] };
  const result = await readiness.executeCheck(appCheck, { cwd: dir, output, env: { PATH: process.env.PATH, E2E_BASE_URL: target } });
  assert.equal(result.receipt.exitCode, 0);
  assert.equal(hits, 2);
  assert.equal(readiness.evaluateEvidence({ ...result, check: appCheck, source: identity, revision: identity.commit }).status, 'not_tested');
});

import { checksFor } from '../../src/scripts/release-readiness.mjs';
test('core gate enables live tests and binds TEST_API_URL to its verified local application', async t => {
  const dir = await fixtureRepo(t), output = await fixtureDirectory(t);
  const identity = await readiness.inspectSource(dir);
  let hits = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ build_sha: identity.commit }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => resolve(undefined))));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const target = `http://127.0.0.1:${address.port}`;
  const core = (await checksFor(fileURLToPath(new URL('../..', import.meta.url)))).find(row => row.id === 'core');
  assert.ok(core);
  const fixture = { ...core, format: 'exit', command: ['node', '-e',
    'console.log(JSON.stringify({run:process.env.RUN_INTEGRATION,test:process.env.TEST_API_URL,e2e:process.env.E2E_BASE_URL}))'] };
  const result = await readiness.executeCheck(fixture, { cwd: dir, output,
    env: { PATH: process.env.PATH, RUN_INTEGRATION: 'false', TEST_API_URL: 'http://unrelated.invalid:3001', E2E_BASE_URL: target } });
  assert.equal(result.receipt.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout.toString()), { run: 'true', test: target, e2e: target });
  assert.equal(hits, 2);
  assert.equal(readiness.evaluateEvidence({ ...result, check: fixture, source: identity, revision: identity.commit }).status, 'passed');
});
