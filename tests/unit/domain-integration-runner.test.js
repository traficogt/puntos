import assert from 'node:assert/strict';
import test from 'node:test';
import {
  domainSuites, selectSuites, isolatedEnvironment, summarizeTap, runCommand
} from '../../src/scripts/run-domain-integration-isolated.mjs';

test('domain filters select only registered suites and reject unknown paths', () => {
  assert.equal(domainSuites.length, 53);
  assert.equal(new Set(domainSuites.map(suite => suite.name)).size, 53);
  assert.deepEqual(selectSuites(['native-wallet-storage', 'operations-runtime-role.test.js']).map(suite => suite.database),
    ['native_wallet_test_storage', 'operations_completion_test']);
  assert.throws(() => selectSuites(['../../production.sql']), /Unknown domain suite/);
  assert.throws(() => selectSuites(['native-wallet-storage', 'typo']), /Unknown domain suite/);
  assert.equal(selectSuites([]).length, 53);
});

test('test environment does not inherit production credentials, opt-ins or Node preload hooks', () => {
  const env = isolatedEnvironment({ PATH: '/usr/bin', HOME: '/home/test', CI: 'true', DB_HOST: 'production',
    DB_PASSWORD_FILE: '/run/secrets/database', JWT_SECRET: 'production-secret', SMTP_PASSWORD: 'private',
    NATIVE_WALLET_TEST_DATABASE_URL: 'postgres://production/db', NODE_OPTIONS: '--import=unsafe.mjs',
    DOCKER_HOST: 'tcp://remote:2375', PGHOST: 'production' }, { port: '55480', password: 'fixture-password', database: 'fixture_test' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/test');
  assert.equal(env.DB_HOST, '127.0.0.1');
  assert.equal(env.DB_PORT, '55480');
  assert.equal(env.DB_NAME, 'fixture_test');
  assert.equal(env.DB_PASSWORD, 'fixture-password');
  assert.equal(env.NODE_ENV, 'test');
  for (const key of ['DB_PASSWORD_FILE', 'SMTP_PASSWORD', 'NATIVE_WALLET_TEST_DATABASE_URL', 'NODE_OPTIONS', 'DOCKER_HOST', 'PGHOST']) assert.equal(env[key], undefined, key);
  assert.notEqual(env.JWT_SECRET, 'production-secret');
});

test('TAP gate rejects successful processes that skipped, cancelled or did not execute tests', () => {
  const output = '# tests 7\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(summarizeTap(output), { tests: 7, pass: 7, fail: 0, cancelled: 0, skipped: 0, todo: 0, ok: true });
  assert.equal(summarizeTap(output.replace('# pass 7', '# pass 6').replace('# skipped 0', '# skipped 1')).ok, false);
  assert.equal(summarizeTap(output.replace('# cancelled 0', '# cancelled 1')).ok, false);
  assert.equal(summarizeTap(output.replace('# todo 0', '# todo 1')).ok, false);
  assert.equal(summarizeTap('arbitrary output').ok, false);
  assert.equal(summarizeTap(output.replaceAll('7', '0')).ok, false);
});

test('command runner retains failing exit status and captures diagnostics without shell interpolation', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.argv[1]); process.exit(7)', '$(do-not-execute)'],
    { cwd: process.cwd(), env: { PATH: process.env.PATH }, timeoutMs: 3000 });
  assert.equal(result.code, 7);
  assert.match(result.output, /\$\(do-not-execute\)/);
});

test('command runner reports unavailable tools and terminates timed-out processes', async () => {
  const options = { cwd: process.cwd(), env: { PATH: process.env.PATH }, timeoutMs: 100 };
  const missing = await runCommand('/nonexistent/puntos-domain-test-tool', [], options);
  assert.equal(missing.code, 127);
  const timeout = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
  assert.equal(timeout.code, 124);
});
