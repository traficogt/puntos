#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand } from "./run-domain-integration-isolated.mjs";
import { parseWorkloadOptions, assertWorkloadHost, workloadEnvironment } from "./workload-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const postgresImage =
  "postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139";
const nodeImage =
  "node:24.22.2-alpine3.24@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node src/scripts/run-workload-isolated.mjs --run [--reads 4..240] [--purchases 1..20] [--concurrency 1..8] [--max-p95-ms 1..10000]",
    );
    return 0;
  }
  const options = parseWorkloadOptions(args);
  assertWorkloadHost(process.env);
  const password = randomBytes(32).toString("hex");
  const runName = `pf-workload-${process.pid}-${randomBytes(6).toString("hex")}`;
  const cwd = await mkdtemp(join(tmpdir(), "pf-workload-"));
  // No repository .env, Docker credentials/context, provider configuration or Node hooks.
  const osEnv = { PATH: process.env.PATH, HOME: cwd, LANG: "C.UTF-8" };
  const env = { ...osEnv, ...workloadEnvironment(password), POSTGRES_PASSWORD: password };
  const abort = new AbortController();
  let exitCode = 0,
    networkCreated = false,
    dbCreated = false,
    runnerCreated = false;
  const interrupt = () => {
    exitCode = 130;
    abort.abort();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const timeout = setTimeout(() => {
    exitCode = 124;
    abort.abort();
  }, 420000);
  const redact = (value) => value.replaceAll(password, "[ephemeral-password]");
  async function docker(args, { checked = true, cleanup = false, timeoutMs = 120000 } = {}) {
    const result = await runCommand("docker", ["--host", "unix:///var/run/docker.sock", ...args], {
      cwd,
      env,
      timeoutMs,
      ...(cleanup ? {} : { signal: abort.signal }),
    });
    if (checked && result.code)
      throw new Error(redact(result.output || "Local Docker command failed"));
    return result;
  }
  try {
    networkCreated = true;
    await docker(["network", "create", "--internal", runName]);
    console.log("[workload] Starting disposable PostgreSQL; services have no published ports");
    dbCreated = true;
    await docker([
      "create",
      "--name",
      `${runName}-db`,
      "--network",
      runName,
      "--network-alias",
      "db",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB=workload_test",
      postgresImage,
    ]);
    await docker(["start", `${runName}-db`]);
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        (
          await docker(
            [
              "exec",
              `${runName}-db`,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-U",
              "postgres",
              "-d",
              "workload_test",
            ],
            { checked: false },
          )
        ).code === 0
      ) {
        ready = true;
        break;
      }
      if (abort.signal.aborted) throw new Error("Interrupted");
      await delay(500);
    }
    if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
    const mounts = ["src", "tests", "public", "node_modules", "package.json"].flatMap((path) => [
      "--mount",
      `type=bind,source=${join(root, path)},target=/work/${path},readonly`,
    ]);
    const environment = Object.keys(workloadEnvironment(password)).flatMap((key) => ["--env", key]);
    runnerCreated = true;
    await docker([
      "create",
      "--name",
      `${runName}-runner`,
      "--network",
      runName,
      "--init",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "1g",
      "--cpus",
      "2",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m",
      "--workdir",
      "/work",
      ...mounts,
      ...environment,
      nodeImage,
      "node",
      "tests/workload/scenario.mjs",
      "--run",
      "--reads",
      String(options.reads),
      "--purchases",
      String(options.purchases),
      "--concurrency",
      String(options.concurrency),
      "--max-p95-ms",
      String(options.maxP95Ms),
    ]);
    console.log(
      `[workload] Applying migrations and running ${options.reads} mixed reads, ${options.purchases} purchases, retries, refunds and restart recovery`,
    );
    const result = await docker(["start", "--attach", `${runName}-runner`], {
      checked: false,
      timeoutMs: 360000,
    });
    process.stdout.write(redact(result.output));
    exitCode ||= result.code;
    // Require a complete report even if Docker exits successfully without executing the scenario.
    const reportLine = result.stdout
      .split("\n")
      .find((line) => line.startsWith("WORKLOAD_REPORT "));
    const report = reportLine ? JSON.parse(reportLine.slice("WORKLOAD_REPORT ".length)) : null;
    if (!report?.correctness?.ok || !report?.recovery?.ok || !report?.performance?.ok)
      exitCode ||= 1;
  } catch (error) {
    console.error(`[workload] ${redact(error.message)}`);
    exitCode ||= 1;
  } finally {
    clearTimeout(timeout);
    for (const [created, name] of [
      [runnerCreated, `${runName}-runner`],
      [dbCreated, `${runName}-db`],
    ]) {
      if (!created) continue;
      const result = await docker(["rm", "--force", "--volumes", String(name)], {
        checked: false,
        cleanup: true,
      });
      if (result.code) {
        console.error(`[workload] Cleanup failed: ${redact(result.output)}`);
        exitCode ||= 1;
      }
    }
    if (networkCreated) {
      const result = await docker(["network", "rm", runName], { checked: false, cleanup: true });
      if (result.code) {
        console.error(`[workload] Network cleanup failed: ${redact(result.output)}`);
        exitCode ||= 1;
      }
    }
    await rm(cwd, { recursive: true, force: true });
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[workload] ${error.message}`);
    process.exitCode = 1;
  });
