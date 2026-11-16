import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

// Run before importing application modules (config loads cwd/.env).
export function assertFailureFixtureEnvironment() {
  assert.equal(process.env.PF_DOMAIN_ISOLATED, '1', 'Use the isolated domain runner');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(existsSync('.env'), false, 'The fixture cwd must not contain .env');
  const target = new URL(process.env.FAILURE_SIMULATIONS_TEST_DB_URL);
  assert.equal(target.protocol, 'postgres:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/failure_simulations_test');
  assert.ok(Number(target.port) > 1024 && target.port !== '5432', 'Use a disposable non-default port');
  assert.equal(target.search, '');
  assert.equal(target.hash, '');
  assert.equal(process.env.DB_HOST, target.hostname);
  assert.equal(process.env.DB_PORT, target.port);
  assert.equal(process.env.DB_NAME, 'failure_simulations_test');
  assert.equal(process.env.DB_USER, decodeURIComponent(target.username));
  assert.equal(process.env.DB_PASSWORD, decodeURIComponent(target.password));
  assert.equal(process.env.MESSAGE_PROVIDER, 'dev');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'NODE_OPTIONS', 'NODE_PATH']) {
    assert.ok(!process.env[key], `Unexpected inherited ${key}`);
  }
  for (const key of Object.keys(process.env)) assert.ok(!key.endsWith('_FILE'), 'Secret-file configuration is forbidden');
  return target.toString();
}

// The parent runner already allowlists its environment. Narrow it again for the
// single child we intentionally interrupt; never copy the caller's whole env.
export function failureWorkerEnvironment() {
  const keys = ['PATH', 'LANG', 'TZ', 'NODE_ENV', 'PF_DOMAIN_ISOLATED',
    'FAILURE_SIMULATIONS_TEST_DB_URL', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER',
    'DB_PASSWORD', 'DB_MIGRATIONS_USER', 'DB_MIGRATIONS_PASSWORD', 'JWT_SECRET',
    'MESSAGE_PROVIDER', 'RATE_LIMIT_DRIVER'];
  return Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}
