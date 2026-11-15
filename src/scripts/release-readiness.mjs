#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- Explicit checkout and newly-created private output paths. */
import { readFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { domainSuites } from './run-domain-integration-isolated.mjs';
import { inspectSource, executeCheck, evaluateEvidence, buildReport, renderMarkdown } from './release-readiness-lib.mjs';

export async function checksFor(cwd) {
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
  // Reuse the existing core suite selection without shell evaluation or accepting arbitrary flags.
  const core = pkg.scripts?.['test:integration:core']?.match(/^NODE_ENV=test node --test --test-concurrency=1 ((?:tests\/integration\/[a-z0-9-]+\.test\.js ?)+)$/)?.[1]?.trim().split(/ +/);
  if (!core?.length) throw new Error('Core test selection is not recognized');
  const node = (...args) => ['node', ...args];
  const tap = (...files) => node('--test', '--test-reporter=tap', '--test-timeout=120000', ...files);
  const browserTools = { playwright: 'node_modules/playwright/package.json' };
  return [
    { id: 'static', title: 'Static release structure and migration checksum checklist', category: 'static', command: node('src/scripts/release-checklist.mjs'), format: 'exit' },
    { id: 'typecheck', title: 'Root configured typecheck', category: 'static', command: node('node_modules/typescript/bin/tsc', '--noEmit', '--singleThreaded'), format: 'exit', tools: { typescript: 'node_modules/typescript/package.json' } },
    { id: 'lint', title: 'Root configured lint', category: 'static', command: node('node_modules/eslint/bin/eslint.js', 'src', 'public', 'tests', '--ext', '.js,.mjs,.cjs', '--max-warnings=0'), format: 'exit', tools: { eslint: 'node_modules/eslint/package.json' } },
    { id: 'unit', title: 'Root unit suite', category: 'functional', command: tap('tests/unit/*.test.js'), format: 'tap' },
    { id: 'core', requiresApplicationIdentity: true, bindTestApi: true, env: { RUN_INTEGRATION: 'true' }, title: 'Existing core functional integration suite (includes DB stubs)', category: 'functional', command: tap('--test-concurrency=1', ...core), format: 'tap' },
    { id: 'merchant-unit', title: 'Merchant website unit suite', category: 'functional', cwd: 'web/merchant', command: tap('tests/*.test.js'), format: 'tap' },
    { id: 'merchant-build', env: { NODE_ENV: 'production' }, title: 'Merchant website build and committed asset consistency', category: 'static', command: ['npm', '--prefix', 'web/merchant', 'run', 'build'], format: 'exit', tools: { vite: 'web/merchant/node_modules/vite/package.json' } },
    { id: 'domains', graceMs: 135000, title: 'Isolated PostgreSQL domain suites', category: 'database', command: node('src/scripts/run-domain-integration-isolated.mjs'), format: 'domains', expectedFiles: domainSuites.map(suite => `${suite.name}.test.js`), timeoutMs: 20 * 60 * 1000 },
    { id: 'pwa', expectedFiles: ['pwa.spec.js'], title: 'Chromium PWA suite with existing static fixture', category: 'browser', command: node('src/scripts/release-readiness-browser.mjs', 'pwa'), format: 'playwright', tools: browserTools, timeoutMs: 10 * 60 * 1000 },
    { id: 'cache-privacy', title: 'Chromium service-worker cache privacy regression', category: 'browser', command: tap('tests/integration/sw-cache-privacy.browser.test.js'), format: 'tap', tools: browserTools },
    { id: 'browser', requiresApplicationIdentity: true, expectedFiles: ['smoke.spec.js', 'auth-security.spec.js', 'flows.spec.js', 'adversarial.spec.js', 'visual.spec.js'], title: 'Chromium smoke, auth, flow, adversarial and visual suites', category: 'browser', command: node('src/scripts/release-readiness-browser.mjs', 'e2e'), format: 'playwright', tools: browserTools, timeoutMs: 30 * 60 * 1000 }
  ].map(check => ({ timeoutMs: 180000, ...check }));
}

const usage = `Usage: npm run ops:release:readiness -- --revision <full-commit-sha> --output <new-directory-outside-checkout> --run all
Use --run static,unit,... for a subset; omitted checks remain not_tested. With no --run, no checks execute.
Requires a clean disposable checkout, installed locked dependencies, and isolated local test services.
There is no evidence import or arbitrary command option. See docs/RELEASE_READINESS.md.`;

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return 0; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--revision', '--output', '--run'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Invalid arguments');
    options[args[i]] = args[i + 1];
  }
  const revision = options['--revision'];
  if (!/^[a-f0-9]{40}$/.test(revision || '') || !options['--output']) throw new Error('Exact revision and output are required');
  const cwd = await realpath(process.cwd());
  const checks = await checksFor(cwd);
  const selected = new Set(options['--run'] === 'all' ? checks.map(check => check.id) : (options['--run'] || '').split(',').filter(Boolean));
  if ([...selected].some(id => !checks.some(check => check.id === id))) throw new Error('Unknown check');
  const requestedOutput = resolve(options['--output']);
  const output = join(await realpath(dirname(requestedOutput)), requestedOutput.split('/').at(-1));
  const within = relative(cwd, output);
  if (!within || (!within.startsWith('../') && !isAbsolute(within))) throw new Error('Output must be outside the checkout');
  await mkdir(output, { mode: 0o700 });
  const initial = await inspectSource(cwd);
  const executions = new Map();
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    if (initial.clean && initial.commit === revision) {
      for (const check of checks) {
        if (!selected.has(check.id) || abort.signal.aborted) continue;
        console.log(`Running ${check.id}`);
        executions.set(check.id, await executeCheck(check, { cwd, output: join(output, 'private'),
          env: { ...process.env, READINESS_BROWSER_OUTPUT: join(output, 'private', `${check.id}-browser`) }, signal: abort.signal }));
      }
    }
    const source = await inspectSource(cwd);
    const results = checks.map(check => evaluateEvidence({ check, ...(executions.get(check.id) || {}), receipt: executions.get(check.id)?.receipt, source, revision }));
    const report = buildReport({ source, revision, results });
    await writeFile(join(output, 'readiness.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await writeFile(join(output, 'readiness.md'), renderMarkdown(report), { mode: 0o600, flag: 'wx' });
    console.log(`Code readiness: ${report.codeReadiness}; pilot readiness: ${report.pilotReadiness}`);
    // Exit describes code readiness. External acceptance is always a separate gate.
    return abort.signal.aborted ? 130 : report.codeReadiness === 'passed' ? 0 : report.codeReadiness === 'failed' ? 1 : 2;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Readiness report could not be produced. Check arguments, Git access and output-directory prerequisites. See --help.');
    process.exitCode = 1;
  });
}
