import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const helper = new URL('../integration/_support/failure-fixture.js', import.meta.url).href;
const environment = {
  PATH: process.env.PATH, NODE_ENV: 'test', PF_DOMAIN_ISOLATED: '1',
  FAILURE_SIMULATIONS_TEST_DB_URL: 'postgres://postgres:fictional@127.0.0.1:55499/failure_simulations_test',
  DB_HOST: '127.0.0.1', DB_PORT: '55499', DB_NAME: 'failure_simulations_test', DB_USER: 'postgres', DB_PASSWORD: 'fictional',
  MESSAGE_PROVIDER: 'dev'
};

test('failure fixture rejects unsafe execution before any application or database imports', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pf-failure-guard-'));
  const check = env => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { assertFailureFixtureEnvironment } from ${JSON.stringify(helper)}; assertFailureFixtureEnvironment();`
  ], { cwd, env, encoding: 'utf8', timeout: 5000 });
  try {
    assert.equal(check(environment).status, 0);
    for (const patch of [
      { PF_DOMAIN_ISOLATED: '' }, { NODE_ENV: 'production' }, { MESSAGE_PROVIDER: 'smtp' },
      { DB_HOST: 'localhost' }, { DB_NAME: 'puntos' },
      { FAILURE_SIMULATIONS_TEST_DB_URL: 'postgres://postgres:fictional@127.0.0.1:5432/failure_simulations_test', DB_PORT: '5432' },
      { FAILURE_SIMULATIONS_TEST_DB_URL: 'postgres://postgres:fictional@db.example.invalid:55499/failure_simulations_test' },
      { DATABASE_URL: 'postgres://unrelated.example.invalid/database' }, { REDIS_URL: 'redis://unrelated.example.invalid' },
      { JWT_SECRET_FILE: '/fixture-secret' }
    ]) {
      const result = check({ ...environment, ...patch });
      assert.equal(result.status, 1, `Guard must reject ${Object.keys(patch).join(', ')}`);
      assert.match(result.stderr, /AssertionError/);
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed filename in this test's newly created temporary directory.
    await writeFile(join(cwd, '.env'), 'FIXTURE_SHOULD_NEVER_LOAD=1\n');
    assert.match(check(environment).stderr, /must not contain .env/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('the interrupted worker receives only its required fictional environment', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { failureWorkerEnvironment } from ${JSON.stringify(helper)}; console.log(JSON.stringify(failureWorkerEnvironment()));`
  ], { env: { ...environment, UNRELATED_SECRET: 'never-copy', PROVIDER_ACCESS_TOKEN: 'never-copy' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0);
  const childEnv = JSON.parse(result.stdout);
  assert.equal(childEnv.DB_PASSWORD, 'fictional');
  assert.equal(childEnv.PF_DOMAIN_ISOLATED, '1');
  assert.equal(childEnv.UNRELATED_SECRET, undefined);
  assert.equal(childEnv.PROVIDER_ACCESS_TOKEN, undefined);
});
