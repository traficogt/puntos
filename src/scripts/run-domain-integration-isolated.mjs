/* eslint-disable security/detect-non-literal-fs-filename -- Only repository-owned directories and a newly created temporary workspace. */
/**
 * Domain database gate (Linux, Docker, installed root dependencies):
 *   npm run test:integration:domains
 *   npm run test:integration:domains -- customer-recovery operations-runtime-role
 *   npm run test:integration:domains -- --list
 *
 * Plan: create a private PostgreSQL container; migrate a template only when
 * needed; recreate each suite's database; run sequentially; reject skipped or
 * failing suites; remove only this run's container, volumes and temporary cwd.
 * The temporary cwd and allowlisted environment exclude the repository .env,
 * inherited database credentials, provider settings and Node preload hooks.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const postgresImage = 'postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139';
const template = 'domain_integration_template';

/** @typedef {{name: string, env: string|null, database: string, fullSchema?: boolean, admin?: boolean}} DomainSuite */
/** @type {DomainSuite[]} */
export const domainSuites = [
  { name: 'acquisition-db', env: 'ACQUISITION_TEST_DATABASE_URL', database: 'acquisition_test' },
  { name: 'activation-insights', env: 'ACTIVATION_INSIGHTS_TEST_DB_URL', database: 'activation_insights_test' },
  { name: 'audience-upgrade', env: 'AUDIENCE_UPGRADE_TEST_DB_URL', database: 'audience_upgrade_test' },
  { name: 'automation-controls', env: 'AUTOMATION_TEST_DB_URL', database: 'automation_test' },
  { name: 'automation-legacy-entrypoints', env: 'AUTOMATION_ENTRYPOINTS_TEST_DB_URL', database: 'automation_entrypoints_test' },
  { name: 'automation-legacy-program', env: 'AUTOMATION_LEGACY_TEST_DATABASE_URL', database: 'automation_legacy_test' },
  { name: 'campaign-expansion', env: 'CAMPAIGN_EXPANSION_TEST_DB_URL', database: 'campaign_expansion_test' },
  { name: 'campaign-measurement-completion', env: 'MEASUREMENT_TEST_DB_URL', database: 'measurement_completion_test', fullSchema: true },
  { name: 'campaign-point-budgets', env: 'CAMPAIGN_LIMITS_TEST_DB_URL', database: 'campaign_limits_test' },
  { name: 'customer-audiences', env: 'AUDIENCES_TEST_DB_URL', database: 'audience_targeting_test' },
  { name: 'customer-migration', env: 'CUSTOMER_MIGRATION_TEST_DB_URL', database: 'migration_launch_test' },
  { name: 'customer-recovery', env: 'CUSTOMER_RECOVERY_TEST_DB_URL', database: 'customer_recovery_test' },
  { name: 'customer-reward-progress', env: 'CUSTOMER_PROGRESS_TEST_DATABASE_URL', database: 'customer_progress_test' },
  { name: 'customer-statement', env: 'CUSTOMER_STATEMENT_TEST_DB_URL', database: 'customer_statement_test' },
  { name: 'demand-funding', env: 'DEMAND_FUNDING_TEST_DB_URL', database: 'demand_funding_test' },
  { name: 'growth-campaigns', env: 'GROWTH_CAMPAIGNS_TEST_DB_URL', database: 'growth_campaigns_test' },
  { name: 'growth-messaging', env: 'GROWTH_MESSAGING_TEST_DB_URL', database: 'growth_messaging_test' },
  { name: 'growth-region-import', env: 'GROWTH_REGION_IMPORT_TEST_DB_URL', database: 'growth_region_import_test' },
  { name: 'growth-review-regressions', env: 'GROWTH_REVIEW_TEST_DB_URL', database: 'campaign_review_regression_test' },
  { name: 'guided-owner-growth', env: 'GUIDED_OWNER_GROWTH_TEST_DB_URL', database: 'guided_owner_growth_test' },
  { name: 'marketing-dispatch-isolation', env: 'AUTOMATION_TEST_DB_URL', database: 'automation_test' },
  { name: 'merchant-catalog', env: 'MERCHANT_CATALOG_TEST_ADMIN_URL', database: 'postgres', admin: true },
  { name: 'merchant-data-readiness', env: 'DECISION_OPERATIONS_TEST_DB_URL', database: 'decision_operations_test' },
  { name: 'merchant-decisions', env: 'DECISIONS_INBOX_TEST_DB_URL', database: 'decisions_inbox_test' },
  { name: 'merchant-launch', env: 'LAUNCH_TEST_DB_URL', database: 'launch_test' },
  { name: 'merchant-overview', env: 'MERCHANT_OVERVIEW_TEST_DB_URL', database: 'merchant_overview_test' },
  { name: 'merchant-operations', env: 'MERCHANT_OPERATIONS_TEST_DB_URL', database: 'merchant_operations_test' },
  { name: 'merchant-pilots', env: 'MERCHANT_PILOTS_TEST_DB_URL', database: 'merchant_pilots_test' },
  { name: 'mobile-reward-refresh', env: 'MOBILE_REWARD_REFRESH_TEST_DATABASE_URL', database: 'mobile_reward_refresh_test' },
  { name: 'mobile-access-storage', env: 'MOBILE_ACCESS_TEST_DATABASE_URL', database: 'mobile_access_test' },
  { name: 'mobile-push-storage', env: 'MOBILE_PUSH_TEST_DATABASE_URL', database: 'mobile_push_test' },
  { name: 'native-wallet-engagement', env: 'WALLET_ENGAGEMENT_TEST_DATABASE_URL', database: 'activation_wallet_test' },
  { name: 'native-wallet-storage', env: 'NATIVE_WALLET_TEST_DATABASE_URL', database: 'native_wallet_test_storage' },
  { name: 'native-wallet-workflow', env: 'NATIVE_WALLET_TEST_DATABASE_URL', database: 'native_wallet_test_workflow' },
  { name: 'operations-runtime-role', env: 'OPERATIONS_RUNTIME_TEST_DB_URL', database: 'operations_completion_test', fullSchema: true },
  { name: 'operations-completion', env: null, database: 'operations_completion_test', fullSchema: true },
  { name: 'owner-email-brief', env: 'OWNER_EMAIL_BRIEF_TEST_DB_URL', database: 'activation_brief_test' },
  { name: 'owner-operations', env: 'OWNER_OPERATIONS_TEST_DB_URL', database: 'owner_operations_test' },
  { name: 'owner-outcome-evidence', env: 'OWNER_OUTCOME_TEST_DB_URL', database: 'owner_outcome_test' },
  { name: 'pos-checkout', env: 'POS_CHECKOUT_TEST_DB_URL', database: 'pos_checkout_test' },
  { name: 'purchase-event-time', env: 'PURCHASE_EVENT_TIME_TEST_DB_URL', database: 'measurement_ingestion_test' },
  { name: 'redemption-pos', env: 'REDEMPTION_POS_TEST_DB_URL', database: 'redemption_pos_test' },
  { name: 'redemption-return', env: 'REDEMPTION_RETURN_TEST_DB_URL', database: 'redemption_return_test' },
  { name: 'referral-growth', env: 'REFERRAL_GROWTH_TEST_DB_URL', database: 'referral_growth_test' },
  { name: 'reporting-purchase', env: 'REPORTING_PURCHASE_TEST_DB_URL', database: 'reporting_purchase_test' },
  { name: 'reward-economics', env: 'REWARD_ECONOMICS_TEST_DB_URL', database: 'reward_economics_test' },
  { name: 'reward-promise-hospitality', env: 'REWARD_PROMISE_TEST_DB_URL', database: 'reward_promise_test' },
  { name: 'reward-workspace', env: 'REWARD_WORKSPACE_TEST_ADMIN_URL', database: 'postgres', admin: true },
  { name: 'rls-check', env: 'RLS_CHECK_TEST_DATABASE_URL', database: 'rls_check_test' },
  { name: 'service-completion', env: 'SERVICE_COMPLETION_TEST_DB_URL', database: 'service_completion_test', fullSchema: true },
  { name: 'service-recovery', env: 'SERVICE_RECOVERY_TEST_DB_URL', database: 'service_recovery_test' },
  { name: 'staff-delegation', env: 'STAFF_DELEGATION_TEST_DB_URL', database: 'staff_delegation_test' },
  { name: 'transaction-explanations', env: 'TRANSACTION_EXPLANATION_TEST_DB_URL', database: 'transaction_explanation_test' }
];

/** @param {string[]} filters */
export function selectSuites(filters) {
  if (!filters.length) return [...domainSuites];
  const names = new Set(filters.map(value => value.replace(/\.test\.js$/, '')));
  for (const name of names) {
    if (!domainSuites.some(suite => suite.name === name)) throw new Error(`Unknown domain suite: ${name}`);
  }
  return domainSuites.filter(suite => names.has(suite.name));
}

/** @param {NodeJS.ProcessEnv} inherited */
function operatingEnvironment(inherited) {
  return Object.fromEntries(['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'CI'].filter(key => inherited[key] !== undefined).map(key => [key, inherited[key]]));
}

/** @param {NodeJS.ProcessEnv} inherited
 * @param {{port: string, password: string, database: string}} database
 * @returns {NodeJS.ProcessEnv} */
export function isolatedEnvironment(inherited, { port, password, database }) {
  return {
    ...operatingEnvironment(inherited), NODE_ENV: 'test', TZ: 'UTC',
    DB_HOST: '127.0.0.1', DB_PORT: port, DB_NAME: database, DB_USER: 'postgres', DB_PASSWORD: password,
    DB_MIGRATIONS_USER: 'postgres', DB_MIGRATIONS_PASSWORD: password,
    JWT_SECRET: `domain-test-${password}`, MESSAGE_PROVIDER: 'dev', RATE_LIMIT_DRIVER: 'memory'
  };
}

/** @param {string} output */
export function summarizeTap(output) {
  const counts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  let fields = 0;
  for (const key of Object.keys(counts)) {
    const match = output.match(new RegExp(`^# ${key} (\\d+)\\s*$`, 'm'));
    if (match) { counts[key] = Number(match[1]); fields++; }
  }
  return { ...counts, ok: fields === 6 && counts.tests > 0 && counts.pass === counts.tests &&
    counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0 };
}

/** @typedef {{cwd: string, env: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal}} CommandOptions */
/** @param {string} executable @param {string[]} args @param {CommandOptions} options
 * @returns {Promise<{code: number, output: string, stdout: string}>} */
export function runCommand(executable, args, { cwd, env, timeoutMs = 180000, signal }) {
  return new Promise(resolveResult => {
    if (signal?.aborted) { resolveResult({ code: 130, output: 'Interrupted', stdout: '' }); return; }
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '', stdout = '', timedOut = false, spawnFailed = false, forcedKill;
    function stop() {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch (_error) { /* Already exited. */ }
      forcedKill = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (_error) { /* Already exited. */ }
      }, 2000);
      forcedKill.unref();
    }
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', chunk => { output += chunk; stdout += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { spawnFailed = true; output += error.message; });
    child.on('close', (code, childSignal) => {
      clearTimeout(timer); clearTimeout(forcedKill); signal?.removeEventListener('abort', stop);
      resolveResult({ code: timedOut ? 124 : spawnFailed ? 127 : code ?? (childSignal === 'SIGINT' ? 130 : childSignal ? 143 : 127), output, stdout });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list') { console.log(domainSuites.map(suite => `${suite.name}${suite.fullSchema ? ' (full schema)' : ''}`).join('\n')); return 0; }
  if (args.length === 1 && args[0] === '--help') { console.log('Usage: npm run test:integration:domains -- [suite-name ... | --list]'); return 0; }
  const suites = selectSuites(args);
  const password = randomBytes(32).toString('hex');
  const containerName = `pf-domain-integration-${process.pid}-${randomBytes(6).toString('hex')}`;
  const osEnv = operatingEnvironment(process.env);
  const workdir = await mkdtemp(join(tmpdir(), 'pf-domain-integration-'));
  const abort = new AbortController();
  let containerId, interrupted = 0, exitCode = 0;
  const interrupt = signal => { interrupted = signal === 'SIGINT' ? 130 : 143; abort.abort(); };
  const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const redact = value => value.replaceAll(password, '[redacted]');
  const results = [];
  async function docker(command, checked = true, cleanup = false) {
    const result = await runCommand('docker', ['--context', 'default', ...command], {
      cwd: workdir, env: { ...osEnv, POSTGRES_PASSWORD: password }, timeoutMs: 120000,
      ...(cleanup ? {} : { signal: abort.signal })
    });
    if (checked && result.code) throw Object.assign(new Error(redact(result.output || 'Docker command failed')), { exitCode: result.code });
    return result;
  }
  try {
    // File-relative imports still resolve in the checkout; cwd-based source and
    // asset reads work without exposing its .env or .secrets files to dotenv.
    for (const directory of ['src', 'tests', 'public', 'web', 'node_modules']) await symlink(join(root, directory), join(workdir, directory), 'dir');
    await symlink(join(root, 'package.json'), join(workdir, 'package.json'), 'file');
    console.log(`[domains] Starting isolated PostgreSQL for ${suites.length} suites`);
    const created = await docker(['create', '--name', containerName, '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=postgres', '--env', 'POSTGRES_DB=postgres', postgresImage]);
    containerId = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error('Docker did not return the created container ID');
    await docker(['start', containerId]);
    const published = (await docker(['port', containerId, '5432/tcp'])).stdout.trim();
    const portMatch = published.match(/^127\.0\.0\.1:(\d+)$/);
    if (!portMatch || portMatch[1] === '5432') throw new Error('Expected an isolated loopback PostgreSQL port');
    const port = portMatch[1];
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      // The image briefly runs a socket-only server during initialization. Wait
      // for TCP so that server's shutdown cannot race the first createdb call.
      if ((await docker(['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], false)).code === 0) { ready = true; break; }
      if (abort.signal.aborted) throw new Error('Interrupted');
      await delay(500);
    }
    if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
    const envFor = database => isolatedEnvironment(process.env, { port, password, database });
    if (suites.some(suite => suite.fullSchema)) {
      console.log('[domains] Applying managed migrations to the isolated template');
      await docker(['exec', containerId, 'createdb', '-U', 'postgres', template]);
      const migration = await runCommand(process.execPath, [join(root, 'src/scripts/migrations.mjs'), 'apply'], {
        cwd: workdir, env: envFor(template), timeoutMs: 180000, signal: abort.signal
      });
      if (migration.code) throw Object.assign(new Error(redact(migration.output)), { exitCode: migration.code });
    }
    for (const suite of suites) {
      if (abort.signal.aborted) break;
      if (!suite.admin) {
        if (!/^[a-z][a-z0-9_]*_test(?:_[a-z0-9_]+)?$/.test(suite.database)) throw new Error(`Unsafe fixture database name: ${suite.database}`);
        await docker(['exec', containerId, 'dropdb', '-U', 'postgres', '--if-exists', '--force', suite.database]);
        await docker(['exec', containerId, 'createdb', '-U', 'postgres', ...(suite.fullSchema ? ['--template', template] : []), suite.database]);
      }
      const env = envFor(suite.database);
      if (suite.env) env[suite.env] = `postgres://postgres:${password}@127.0.0.1:${port}/${suite.database}`;
      console.log(`[domains] Running ${suite.name}`);
      const start = Date.now();
      const result = await runCommand(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=120000', join(root, `tests/integration/${suite.name}.test.js`)], {
        cwd: workdir, env, timeoutMs: 150000, signal: abort.signal
      });
      const summary = summarizeTap(result.output);
      const code = result.code || (summary.ok ? 0 : 1);
      if (code) { console.error(redact(result.output)); exitCode ||= code; }
      const report = { file: `${suite.name}.test.js`, exit: code, seconds: Number(((Date.now() - start) / 1000).toFixed(1)), ...summary, ok: code === 0 };
      results.push(report);
      console.log(JSON.stringify(report));
    }
    console.log(JSON.stringify({ suites: results.length, expectedSuites: suites.length,
      tests: results.reduce((total, result) => total + result.tests, 0),
      pass: results.reduce((total, result) => total + result.pass, 0),
      failedSuites: results.filter(result => result.exit !== 0).length }));
    if (results.length !== suites.length) exitCode ||= 1;
  } catch (error) {
    console.error(`[domains] ${redact(error.message)}`);
    exitCode ||= error.exitCode || 1;
  } finally {
    if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
      const cleanup = await docker(['rm', '--force', '--volumes', containerId], false, true);
      if (cleanup.code) { console.error(`[domains] Container cleanup failed: ${redact(cleanup.output)}`); exitCode ||= cleanup.code; }
    }
    await rm(workdir, { recursive: true, force: true });
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  }
  return interrupted || exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
