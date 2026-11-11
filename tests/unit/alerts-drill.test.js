import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const credentialNames = ["E2E_APP_DB_PASSWORD", "E2E_DB_ADMIN_PASSWORD", "E2E_SUPER_ADMIN_PASSWORD"];

async function fixture(t, script = "alerts-drill.sh") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puntos-alerts-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "src/scripts");
  // All paths below belong to the isolated fixture created by this test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(scripts, { recursive: true });
  for (const name of [script, "wait-for-api.sh"]) {
    await fs.copyFile(new URL(`../../src/scripts/${name}`, import.meta.url), path.join(scripts, name));
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(path.join(root, "deploy/e2e"), { recursive: true });
  await fs.copyFile(new URL("../../deploy/e2e/api.env", import.meta.url), path.join(root, "deploy/e2e/api.env"));
  const eventsPath = path.join(root, "commands.jsonl");
  const command = `#!/usr/bin/env node
const fs = require('node:fs');
const crypto = require('node:crypto');
const name = require('node:path').basename(process.argv[1]);
const names = ${JSON.stringify(credentialNames)};
const args = process.argv.slice(2);
const containsCredential = args.some((arg) => names.some((key) => process.env[key] && arg.includes(process.env[key])));
const safeArgs = args.map((arg, index) => /(?:PASSWORD|TOKEN|SECRET)=/.test(arg) || args[index - 1] === '--metrics-token' ? '[private argument]' : arg);
const credentials = Object.fromEntries(names.map((key) => {
  const value = process.env[key] || '';
  return [key, { present: Boolean(value), randomHex: /^[a-f0-9]{48}$/.test(value), hash: crypto.createHash('sha256').update(value).digest('hex') }];
}));
const login = { email: process.env.SUPER_ADMIN_EMAIL || '', passwordHash: crypto.createHash('sha256').update(process.env.SUPER_ADMIN_PASSWORD || '').digest('hex') };
fs.appendFileSync(process.env.MOCK_COMMAND_EVENTS, JSON.stringify({ name, args: safeArgs, credentials, containsCredential, login }) + '\\n', { mode: 0o600 });
if (name === 'docker') {
  const missing = names.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('Compose credentials missing: ' + missing.join(', '));
    process.exit(1);
  }
}
`;
  for (const name of ["docker", "curl", "npm", "npx"]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(path.join(root, name), command, { mode: 0o700 });
  }
  const run = async (overrides = {}) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(eventsPath, "", { mode: 0o600 });
    const result = spawnSync("bash", [path.join(scripts, script)], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        MOCK_COMMAND_EVENTS: eventsPath,
        E2E_RUNNER: "docker",
        TEST_API_URL: "",
        ...Object.fromEntries(credentialNames.map((name) => [name, ""])),
        ...overrides
      },
      encoding: "utf8",
      timeout: 10000
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const events = (await fs.readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { result, events };
  };
  return { run };
}

test("alert drill exports fresh private credentials before Compose and retains them through cleanup", async (t) => {
  const { run } = await fixture(t);
  const fingerprints = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { result, events } = await run();
    assert.equal(result.status, 0, result.stderr);
    const dockerEvents = events.filter((event) => event.name === "docker");
    assert.equal(dockerEvents.length, 2, "The isolated stack must start and be cleaned up");
    assert.ok(dockerEvents[0].args.includes("up"));
    assert.ok(dockerEvents[1].args.includes("down"));
    const credentials = dockerEvents[0].credentials;
    assert.ok(credentialNames.every((name) => credentials[name].randomHex), "Each password must have 24 random bytes");
    assert.equal(new Set(credentialNames.map((name) => credentials[name].hash)).size, 3);
    assert.deepEqual(dockerEvents[1].credentials, credentials, "Cleanup must use the same Compose environment");
    assert.equal(events.filter((event) => event.name === "npm").length, 2, "Both alert checks must run");
    fingerprints.push(credentialNames.map((name) => credentials[name].hash));
  }
  assert.ok(fingerprints[0].every((value, index) => value !== fingerprints[1][index]), "Each drill must receive new credentials");
});

test("alert drill preserves explicit test credentials without printing or passing them as command arguments", async (t) => {
  const { run } = await fixture(t);
  const overrides = Object.fromEntries(credentialNames.map((name) => [name, randomBytes(24).toString("hex")]));
  const { result, events } = await run(overrides);
  assert.equal(result.status, 0, result.stderr);
  for (const name of credentialNames) {
    const expectedHash = createHash("sha256").update(overrides[name]).digest("hex");
    assert.ok(events.every((event) => event.credentials[name].hash === expectedHash));
    assert.ok(events.every((event) => !event.containsCredential));
    assert.ok(!`${result.stdout}${result.stderr}${JSON.stringify(events)}`.includes(overrides[name]));
  }
});

test("isolated E2E launcher bootstraps fresh Compose credentials before starting its runner", async (t) => {
  const { run } = await fixture(t, "run-e2e-isolated.sh");
  const fingerprints = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { result, events } = await run();
    assert.equal(result.status, 0, result.stderr);
    const dockerEvents = events.filter((event) => event.name === "docker");
    const credentials = dockerEvents[0].credentials;
    assert.ok(credentialNames.every((name) => credentials[name].randomHex));
    assert.equal(new Set(credentialNames.map((name) => credentials[name].hash)).size, 3);
    assert.ok(dockerEvents.some((event) => event.args.includes("e2e") && event.args.includes("run")));
    assert.ok(dockerEvents.at(-1).args.includes("down"));
    assert.ok(dockerEvents.every((event) => JSON.stringify(event.credentials) === JSON.stringify(credentials)));
    fingerprints.push(credentialNames.map((name) => credentials[name].hash));
  }
  assert.ok(fingerprints[0].every((value, index) => value !== fingerprints[1][index]));
});

test("isolated live smoke expects the fixture's HTTP super cookie", async (t) => {
  const { run } = await fixture(t, "run-live-integration-isolated.sh");
  const { result, events } = await run();
  assert.equal(result.status, 0, result.stderr);
  const smoke = events.find((event) => event.args.includes("src/scripts/deploy-smoke.mjs"));
  assert.ok(smoke);
  assert.equal(smoke.args[smoke.args.indexOf("--base-url") + 1], "http://api:3001");
  assert.ok(smoke.args.includes("--super-cookie-name"));
  assert.equal(smoke.args[smoke.args.indexOf("--super-cookie-name") + 1], "pf_super");
});

test("isolated live ledger checks retain the super email seeded by the Compose fixture", async (t) => {
  const { run } = await fixture(t, "run-live-integration-isolated.sh");
  const { result, events } = await run();
  assert.equal(result.status, 0, result.stderr);
  // Fixed repository test configuration, independent of operator environment files.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fixtureEnvironment = await fs.readFile(new URL("../../deploy/e2e/api.env", import.meta.url), "utf8");
  const fixtureEmail = fixtureEnvironment.match(/^SUPER_ADMIN_EMAIL=(.+)$/m)?.[1];
  assert.ok(fixtureEmail);
  const ledgerChecks = events.filter((event) => event.args.some((arg) => /^src\/scripts\/live-(?:ledger-(?:certification|correction)|staff-ledger)-check\.mjs$/.test(arg)));
  assert.equal(ledgerChecks.length, 3);
  for (const event of ledgerChecks) {
    const emailOverride = event.args.find((arg) => arg.startsWith("SUPER_ADMIN_EMAIL="));
    assert.equal(emailOverride?.slice("SUPER_ADMIN_EMAIL=".length) || fixtureEmail, fixtureEmail);
  }
});

test("host E2E runner receives the fixture identity and generated API password instead of ambient credentials", async (t) => {
  const { run } = await fixture(t, "run-e2e-isolated.sh");
  const ambientPassword = randomBytes(24).toString("hex");
  const { result, events } = await run({
    E2E_RUNNER: "host",
    SUPER_ADMIN_EMAIL: "unrelated-admin@example.invalid",
    SUPER_ADMIN_PASSWORD: ambientPassword
  });
  assert.equal(result.status, 0, result.stderr);
  const runner = events.find((event) => event.name === "npx");
  assert.ok(runner?.args.includes("playwright"));
  // Fixed repository test configuration, independent of operator environment files.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fixtureEnvironment = await fs.readFile(new URL("../../deploy/e2e/api.env", import.meta.url), "utf8");
  const fixtureEmail = fixtureEnvironment.match(/^SUPER_ADMIN_EMAIL=(.+)$/m)?.[1];
  assert.ok(fixtureEmail);
  assert.equal(runner.login.email, fixtureEmail);
  const generatedPasswordHash = events[0].credentials.E2E_SUPER_ADMIN_PASSWORD.hash;
  assert.equal(runner.login.passwordHash, generatedPasswordHash);
  assert.notEqual(runner.login.passwordHash, createHash("sha256").update(ambientPassword).digest("hex"));
  assert.ok(!runner.containsCredential, "The generated password belongs in the runner environment, not command arguments");
  assert.ok(!`${result.stdout}${result.stderr}${JSON.stringify(events)}`.includes(ambientPassword));
});
