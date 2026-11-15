import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { expectedWebkitTests, validateWebkitReport, webkitEnvironment } from '../../src/scripts/run-webkit-isolated.mjs';

function config(webkit = false) {
  const url = new URL('../../playwright.config.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { default: config } = await import(${JSON.stringify(url)}); console.log(JSON.stringify(config));`], {
    cwd: tmpdir(), encoding: 'utf8', env: { PATH: process.env.PATH, ...(webkit ? { E2E_WEBKIT: '1' } : {}) }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('browser launch flags are scoped to Chromium and WebKit is opt-in', () => {
  const defaults = config();
  assert.deepEqual(defaults.projects.map(project => project.name), ['firefox', 'chromium']);
  assert.equal(defaults.use.launchOptions, undefined);
  assert.equal(defaults.projects[0].use.launchOptions, undefined);
  assert.deepEqual(defaults.projects[1].use.launchOptions.args, ['--no-sandbox', '--disable-setuid-sandbox']);
  const webkit = config(true).projects.find(project => project.name === 'webkit');
  assert.equal(webkit.use.browserName, 'webkit');
  assert.equal(webkit.use.launchOptions, undefined);
  assert.equal(webkit.retries, 0);
  assert.equal(webkit.testMatch, '**/webkit-customer.spec.js');
  for (const project of defaults.projects) assert.equal(project.testIgnore, '**/webkit-customer.spec.js');
});

function passingReport() {
  return { errors: [], suites: expectedWebkitTests.map(name => {
    const [layout, title] = name.split(': ');
    return { title: layout, specs: [{ title, tests: [{ projectName: 'webkit', expectedStatus: 'passed',
      status: 'expected', results: [{ status: 'passed', retry: 0 }] }] }] };
  }) };
}

test('WebKit acceptance requires every named test to pass once', () => {
  assert.deepEqual(validateWebkitReport(passingReport()), { tests: 4, passed: 4, skipped: 0, retries: 0 });
  const listed = passingReport();
  for (const suite of listed.suites) suite.specs[0].tests[0].results = [];
  assert.deepEqual(validateWebkitReport(listed, { listed: true }), { tests: 4 });
  assert.throws(() => validateWebkitReport(listed), /failed, skipped or retried/);
  for (const mutate of [
    report => report.suites.pop(),
    report => report.suites.push(report.suites[0]),
    report => { report.suites[0].specs[0].title = 'different coverage'; },
    report => { report.suites[0].specs[0].tests[0].projectName = 'chromium'; },
    report => { report.suites[0].specs[0].tests[0].expectedStatus = 'skipped'; },
    report => { report.suites[0].specs[0].tests[0].results[0].status = 'skipped'; },
    report => { report.suites[0].specs[0].tests[0].results[0].status = 'failed'; },
    report => { report.suites[0].specs[0].tests[0].results[0].retry = 1; },
    report => { report.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }); },
    report => { report.errors = ['browser unavailable']; }
  ]) {
    const report = passingReport();
    mutate(report);
    assert.throws(() => validateWebkitReport(report));
  }
  assert.throws(() => validateWebkitReport({}));
});

test('WebKit fixture discards inherited targets, provider credentials and runner overrides', () => {
  const env = webkitEnvironment({ PATH: '/usr/bin', HOME: '/home/test', CI: 'true',
    E2E_BASE_URL: 'https://production.example', DATABASE_URL: 'postgres://production/db',
    NODE_OPTIONS: '--import=production.js', SMTP_PASSWORD: 'secret',
    MESSAGE_PROVIDER: 'whatsapp', DOCKER_HOST: 'tcp://remote:2375',
    PLAYWRIGHT_JSON_OUTPUT_NAME: '/tmp/other-report', PLAYWRIGHT_BROWSERS_PATH: '/other-browser',
    E2E_WEBKIT: '0' });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/test', CI: 'true', NODE_ENV: 'test',
    E2E_WEBKIT: '1', E2E_WEBKIT_ISOLATED: '1', PLAYWRIGHT_BROWSERS_PATH: '0' });
});

test('WebKit acceptance refuses target arguments and test filters before creating fixtures', () => {
  const runner = new URL('../../src/scripts/run-webkit-isolated.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [runner.pathname, '--grep=only-one'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /takes no filters or target overrides/);
});
