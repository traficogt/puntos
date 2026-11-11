import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const sqlDump = "-- PostgreSQL database dump\nCREATE TABLE public.backup_probe (id integer);\n-- PostgreSQL database dump complete\n";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puntos-backup-test-"));
  // All paths below are isolated fixtures created by this test.
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "src/scripts");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.mkdir(scripts, { recursive: true });
  for (const name of ["backup-db.sh", "verify-backup.mjs", "write-ops-report.mjs", "backup-health.sh"]) {
    // Fixed operator scripts are copied into the isolated fixture.
    await fs.copyFile(new URL(`../../src/scripts/${name}`, import.meta.url), path.join(scripts, name));
  }
  const docker = path.join(root, "docker");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(docker, `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.MOCK_DOCKER_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.MOCK_SQL_DUMP);
process.exit(process.env.MOCK_DUMP_FAILURE === '1' ? 1 : 0);
`, { mode: 0o700 });
  const argsFile = path.join(root, "docker-args.json");
  const output = path.join(root, "backups");
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, DB_USER: "restricted-app", BACKUP_DB_USER: "backup-admin", MOCK_DOCKER_ARGS: argsFile, MOCK_SQL_DUMP: sqlDump };
  const run = (script, args = [], overrides = {}) => spawnSync("bash", [path.join(scripts, script), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: "utf8" });
  return { root, output, argsFile, run, scripts };
}

test("backup verification rejects empty gzip archives and truncated SQL dumps", async (t) => {
  const { root, scripts } = await fixture(t);
  for (const contents of ["", "-- PostgreSQL database dump\nCREATE TABLE public.incomplete(id integer);\n"]) {
    const file = path.join(root, "invalid.sql.gz");
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(file, gzipSync(contents));
    const result = spawnSync(process.execPath, [path.join(scripts, "verify-backup.mjs"), "--file", file], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "An empty or incomplete dump must not be considered recoverable");
  }
});

test("failed pg_dump never leaves a published backup archive", async (t) => {
  const { run, output } = await fixture(t);
  const result = run("backup-db.sh", [output], { MOCK_DUMP_FAILURE: "1" });
  assert.notEqual(result.status, 0);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  assert.deepEqual(await fs.readdir(output), [], "Failed dumps must be removed, including temporary files");
});

test("successful backups use the backup role and private files with verified metadata", async (t) => {
  const { run, output, argsFile } = await fixture(t);
  const result = run("backup-db.sh", [output]);
  assert.equal(result.status, 0, result.stderr);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const args = JSON.parse(await fs.readFile(argsFile, "utf8"));
  assert.equal(args[args.indexOf("-U") + 1], "backup-admin");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = await fs.readdir(output);
  assert.equal(files.length, 3);
  assert.ok(files.some((name) => name.endsWith(".sql.gz")));
  assert.ok(files.some((name) => name.endsWith(".sha256")));
  assert.ok(files.some((name) => name.endsWith(".json")));
  for (const name of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = await fs.stat(path.join(output, name));
    assert.equal(stat.mode & 0o777, 0o600, "Backup data and metadata must be owner-readable only");
  }
});

test("backup health rejects recent empty archives without verification metadata", async (t) => {
  const { root, run } = await fixture(t);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(path.join(root, "puntos_20260101_000000.sql.gz"), gzipSync(""));
  const result = run("backup-health.sh", ["--dir", root]);
  assert.notEqual(result.status, 0, "A fresh modification time cannot make an empty backup healthy");
});
