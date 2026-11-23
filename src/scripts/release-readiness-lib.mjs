/* eslint-disable security/detect-non-literal-fs-filename -- Paths come from Git or private, newly-created evidence directories. */
import { createHash } from "node:crypto";

export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const countKeys = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
const emptyCounts = () => ({
  tests: 0,
  pass: 0,
  fail: 0,
  cancelled: 0,
  skipped: 0,
  todo: 0,
  valid: false,
});
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export const digest = (value) => createHash("sha256").update(value).digest("hex");

export function hasBrowserCompletion(output, kind, expectedChecks) {
  const records = [];
  for (const line of output.split("\n")) {
    try {
      const value = JSON.parse(line);
      if (value?.kind === kind) records.push(value);
    } catch {
      /* Ordinary runner output is not a completion receipt. */
    }
  }
  return (
    Number.isSafeInteger(expectedChecks) &&
    expectedChecks > 0 &&
    records.length === 1 &&
    records[0].checks === expectedChecks &&
    records[0].passed === true
  );
}

function validCounts(counts) {
  return (
    countKeys.every((key) => integer(counts[key])) &&
    counts.tests > 0 &&
    counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo === counts.tests
  );
}

export function parseTap(output) {
  const counts = emptyCounts();
  if (
    !/^TAP version 13\r?$/m.test(output) ||
    !/^1\.\.\d+\r?$/m.test(output) ||
    !/^# duration_ms \d+(?:\.\d+)?\s*$/m.test(output)
  )
    return counts;
  const plans = [...output.matchAll(/^1\.\.(\d+)\r?$/gm)];
  const observations = [...output.matchAll(/^(?:not )?ok (\d+)(?: - .*)?\r?$/gm)];
  if (
    plans.length !== 1 ||
    !observations.length ||
    Number(plans[0][1]) !== observations.length ||
    observations.some((match, index) => Number(match[1]) !== index + 1)
  )
    return counts;
  for (const key of countKeys) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm"))];
    if (matches.length !== 1) return emptyCounts();
    counts[key] = Number(matches[0][1]);
  }
  counts.valid =
    validCounts(counts) &&
    (!/^\s*not ok \d+/m.test(output) || counts.fail + counts.cancelled > 0) &&
    (!/ # SKIP\b/i.test(output) || counts.skipped > 0) &&
    (!/ # TODO\b/i.test(output) || counts.todo > 0);
  return counts;
}

export function parsePlaywright(output, expectedFiles = [], expectedProjects = []) {
  const counts = emptyCounts();
  try {
    const report = JSON.parse(output);
    if (
      !Array.isArray(report.suites) ||
      !Array.isArray(report.errors) ||
      report.errors.length ||
      !report.stats
    )
      return counts;
    let expected = 0,
      unexpected = 0,
      flaky = 0,
      skipped = 0;
    const observedFiles = new Set();
    const observedProjects = new Set();
    function visit(suites) {
      for (const suite of suites) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            counts.tests++;
            if (typeof spec.file === "string") {
              const file = spec.file.replaceAll("\\", "/");
              observedFiles.add(file);
              if (typeof test.projectName === "string")
                observedProjects.add(`${file}:${test.projectName}`);
            }
            if (!Array.isArray(test.results) || !test.results.length)
              throw new Error("Missing results");
            if (test.status === "expected") expected++;
            else if (test.status === "unexpected") unexpected++;
            else if (test.status === "flaky") flaky++;
            else if (test.status === "skipped") skipped++;
            else throw new Error("Unknown outcome");
            if (test.results.some((result) => result.status === "skipped")) counts.skipped++;
            else if (test.results.some((result) => result.status === "interrupted"))
              counts.cancelled++;
            else if (
              test.expectedStatus === "passed" &&
              test.status === "expected" &&
              test.results.length === 1 &&
              test.results[0].status === "passed"
            )
              counts.pass++;
            else counts.fail++;
          }
        }
        visit(suite.suites || []);
      }
    }
    visit(report.suites);
    counts.valid =
      validCounts(counts) &&
      expected === report.stats.expected &&
      unexpected === report.stats.unexpected &&
      flaky === report.stats.flaky &&
      skipped === report.stats.skipped &&
      expectedFiles.every(
        (file) =>
          observedFiles.has(file) &&
          expectedProjects.every((project) => observedProjects.has(`${file}:${project}`)),
      );
  } catch (_error) {
    counts.valid = false;
  }
  return counts;
}

export function parseDomains(output, expectedFiles) {
  const counts = emptyCounts();
  try {
    const rows = output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    const totals = rows.filter((row) => Object.hasOwn(row, "expectedSuites"));
    const suites = rows.filter((row) => Object.hasOwn(row, "file"));
    if (
      totals.length !== 1 ||
      suites.length !== expectedFiles.length ||
      new Set(suites.map((row) => row.file)).size !== expectedFiles.length ||
      !expectedFiles.every((file) => suites.some((row) => row.file === file))
    )
      return counts;
    if (!suites.every((row) => validCounts(row) && integer(row.exit))) return counts;
    for (const key of countKeys) counts[key] = suites.reduce((total, row) => total + row[key], 0);
    const total = totals[0];
    counts.valid =
      total.suites === suites.length &&
      total.expectedSuites === expectedFiles.length &&
      total.tests === counts.tests &&
      total.pass === counts.pass &&
      total.failedSuites === suites.filter((row) => row.exit !== 0).length &&
      suites.every((row) => row.exit === 0 || row.pass !== row.tests) &&
      validCounts(counts);
    if (suites.some((row) => row.exit !== 0)) counts.valid = false;
  } catch (_error) {
    counts.valid = false;
  }
  return counts;
}

function sameSource(a, b) {
  return (
    a?.clean === true &&
    b?.clean === true &&
    a.commit === b.commit &&
    a.tree === b.tree &&
    a.contentSha256 === b.contentSha256
  );
}

/** @typedef {{ id: string, title: string, category: string, command: string[], status: string, reason: string,
 * startedAt?: string, finishedAt?: string, durationMs?: number, toolVersions?: Record<string, string>,
 * exitCode?: number|null, signal?: string|null, counts?: ReturnType<typeof emptyCounts>|null,
 * cancelled?: boolean, timedOut?: boolean, truncated?: boolean, application?: any,
 * artifacts?: Record<string, {sha256: string, bytes: number}> }} EvidenceResult */
/** Evaluate captured bytes, never a caller-supplied status or counts field.
 * @returns {EvidenceResult} */
export function evaluateEvidence({
  check,
  receipt,
  stdout,
  stderr,
  source,
  revision,
  now = new Date(),
}) {
  const base = {
    id: check.id,
    title: check.title,
    category: check.category,
    command: check.command,
    status: "not_tested",
    reason: "missing_evidence",
  };
  const reject = (reason) => ({ ...base, reason });
  if (!receipt) return base;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.checkId !== check.id ||
    JSON.stringify(receipt.command) !== JSON.stringify(check.command)
  )
    return reject("invalid_receipt");
  const start = Date.parse(receipt.startedAt),
    end = Date.parse(receipt.finishedAt);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    end > now.getTime() ||
    now.getTime() - start > MAX_AGE_MS ||
    !integer(receipt.durationMs) ||
    receipt.durationMs !== end - start
  )
    return reject("stale_or_invalid_time");
  if (!/^v\d+\.\d+\.\d+$/.test(receipt.toolVersions?.node || ""))
    return reject("invalid_tool_version");
  for (const [name, bytes] of [
    ["stdout", stdout],
    ["stderr", stderr],
  ]) {
    const artifact = receipt.artifacts?.[name];
    if (
      !Buffer.isBuffer(bytes) ||
      artifact?.sha256 !== digest(bytes) ||
      artifact?.bytes !== bytes.length
    )
      return reject("artifact_mismatch");
  }
  const toolVersions = { node: receipt.toolVersions.node };
  for (const tool of Object.keys(check.tools || {})) {
    const version = receipt.toolVersions[tool];
    if (/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version || "")) toolVersions[tool] = version;
  }
  /** @type {EvidenceResult} */
  const result = {
    ...base,
    startedAt: receipt.startedAt,
    finishedAt: receipt.finishedAt,
    durationMs: receipt.durationMs,
    toolVersions,
    cancelled: receipt.cancelled === true,
    timedOut: receipt.timedOut === true,
    truncated: receipt.truncated === true,
    exitCode: Number.isInteger(receipt.exitCode) ? receipt.exitCode : null,
    signal: ["SIGTERM", "SIGINT", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(receipt.signal)
      ? receipt.signal
      : null,
    artifacts: {
      stdout: { sha256: digest(stdout), bytes: stdout.length },
      stderr: { sha256: digest(stderr), bytes: stderr.length },
    },
  };
  const output = stdout.toString("utf8");
  const counts =
    check.format === "tap"
      ? parseTap(output)
      : check.format === "playwright"
        ? parsePlaywright(output, check.expectedFiles, check.expectedProjects)
        : check.format === "domains"
          ? parseDomains(output, check.expectedFiles)
          : null;
  if (
    source.commit !== revision ||
    !sameSource(source, receipt.sourceBefore) ||
    !sameSource(source, receipt.sourceAfter)
  )
    return { ...result, counts, status: "not_tested", reason: "source_mismatch_or_dirty" };
  if (check.requiresApplicationIdentity) {
    const expected = revision;
    const before = receipt.application?.before,
      after = receipt.application?.after;
    result.application = {
      before: /^[a-f0-9]{40}$/.test(before || "") ? before : null,
      after: /^[a-f0-9]{40}$/.test(after || "") ? after : null,
    };
    if (before !== expected || after !== expected)
      return { ...result, counts, status: "not_tested", reason: "application_revision_unverified" };
  }
  if (receipt.exitCode === 127 || (counts && counts.tests === 0))
    return { ...result, counts, status: "not_tested", reason: "no_observed_execution" };
  if (
    receipt.exitCode !== 0 ||
    receipt.signal !== null ||
    receipt.timedOut !== false ||
    receipt.truncated !== false ||
    receipt.cancelled !== false
  )
    return { ...result, counts, status: "failed", reason: "command_failed_or_incomplete" };
  if (counts && (!counts.valid || counts.pass !== counts.tests))
    return { ...result, counts, status: "failed", reason: "tests_failed_skipped_or_incomplete" };
  if (!counts && check.format !== "exit") return reject("unknown_reporter");
  return {
    ...result,
    counts,
    status: "passed",
    reason: counts ? "executed_tests_passed" : "command_completed",
  };
}

import { execFileSync, spawn } from "node:child_process";
import { lstat, readFile, readlink, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function inspectSource(cwd) {
  const git = (args) =>
    execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  if (git(["rev-parse", "--show-toplevel"]).trim() !== cwd)
    throw new Error("Run from the repository root");
  const commit = git(["rev-parse", "--verify", "HEAD"]).trim();
  const tree = git(["rev-parse", "HEAD^{tree}"]).trim();
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const committed = new Map(
    git(["ls-tree", "-rz", "--full-tree", "HEAD"])
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("\t");
        const [mode, kind, oid] = entry.slice(0, separator).split(" ");
        if (kind !== "blob") throw new Error("Unsupported tracked object");
        return [entry.slice(separator + 1), { mode, oid }];
      }),
  );
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const hash = createHash("sha256");
  let modifiedTrackedFiles = 0;
  for (const file of [...new Set([...committed.keys(), ...tracked, ...untracked])].sort()) {
    let entry;
    try {
      const info = await lstat(join(cwd, file));
      const kind = info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : "unsupported";
      if (kind === "unsupported") throw new Error("Unsupported tracked file");
      const bytes =
        kind === "symlink"
          ? Buffer.from(await readlink(join(cwd, file)))
          : await readFile(join(cwd, file));
      entry = [file, kind, info.mode & 0o111, digest(bytes)];
      const expected = committed.get(file);
      const mode = kind === "symlink" ? "120000" : info.mode & 0o111 ? "100755" : "100644";
      const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (expected && (expected.oid !== oid || expected.mode !== mode)) modifiedTrackedFiles++;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      entry = [file, "missing"];
      if (committed.has(file)) modifiedTrackedFiles++;
    }
    hash.update(JSON.stringify(entry) + "\n");
  }
  return {
    commit,
    tree,
    contentSha256: hash.digest("hex"),
    clean: status.length === 0 && modifiedTrackedFiles === 0,
    modifiedTrackedFiles,
    trackedFiles: tracked.length,
    untrackedFiles: untracked.length,
    dirtyEntries: status.split("\0").filter(Boolean).length,
  };
}

/** @param {string} executable @param {string[]} args
 * @param {{cwd: string, env: NodeJS.ProcessEnv, timeoutMs?: number, maxBytes?: number, signal?: AbortSignal, graceMs?: number}} options */
export function capture(
  executable,
  args,
  { cwd, env, timeoutMs = 180000, maxBytes = 8 * 1024 * 1024, signal, graceMs = 2000 },
) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        exitCode: 130,
        signal: "SIGINT",
        timedOut: false,
        truncated: false,
        cancelled: true,
      });
      return;
    }
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let size = 0,
      truncated = false,
      timedOut = false,
      spawnFailed = false,
      forcedKill;
    function stop() {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (_error) {
        /* Process group already stopped. */
      }
      if (!forcedKill)
        forcedKill = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (_error) {
            /* Process group already stopped. */
          }
        }, graceMs);
    }
    function collect(chunks, chunk) {
      const remaining = Math.max(0, maxBytes - size);
      chunks.push(chunk.subarray(0, remaining));
      size += chunk.length;
      if (size > maxBytes) {
        truncated = true;
        stop();
      }
    }
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.on("error", () => {
      spawnFailed = true;
    });
    child.on("close", (code, childSignal) => {
      // A leader can exit while a stdio-detached descendant ignores SIGTERM.
      // Finish group cleanup before cancelling the escalation timer.
      if (forcedKill && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (_error) {
          /* Group already exited. */
        }
      }
      clearTimeout(timer);
      clearTimeout(forcedKill);
      signal?.removeEventListener("abort", stop);
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: spawnFailed ? 127 : code,
        signal: childSignal,
        timedOut,
        truncated,
        cancelled: signal?.aborted === true,
      });
    });
  });
}

/** Forward wrapper termination to its detached child group before exiting.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} operation
 * @returns {Promise<T>} */
export async function withProcessCancellation(operation) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGTERM", abort);
  process.on("SIGINT", abort);
  try {
    return await operation(controller.signal);
  } finally {
    process.off("SIGTERM", abort);
    process.off("SIGINT", abort);
  }
}

async function applicationRevision(baseUrl = "http://127.0.0.1:3001") {
  try {
    const base = new URL(baseUrl);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      return null;
    const response = await fetch(new URL("/api/info", base), {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16384) return null;
      chunks.push(chunk);
    }
    const revision = JSON.parse(Buffer.concat(chunks).toString("utf8")).build_sha;
    return /^[a-f0-9]{40}$/.test(revision || "") ? revision : null;
  } catch (_error) {
    return null;
  }
}

/** @param {any} check @param {{cwd: string, output: string, env: NodeJS.ProcessEnv, signal?: AbortSignal}} options */
export async function executeCheck(check, { cwd, output, env, signal }) {
  if (!/^[a-z][a-z0-9-]*$/.test(check.id)) throw new Error("Invalid check identifier");
  const sourceBefore = await inspectSource(cwd);
  const startedAt = new Date().toISOString();
  const applicationBase = env.E2E_BASE_URL || "http://127.0.0.1:3001";
  const childEnv = {
    ...env,
    NODE_ENV: "test",
    ...check.env,
    ...(check.requiresApplicationIdentity ? { E2E_BASE_URL: applicationBase } : {}),
    ...(check.requiresApplicationIdentity && check.bindTestApi
      ? { TEST_API_URL: applicationBase }
      : {}),
    ...(check.category === "browser"
      ? { PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH || "0" }
      : {}),
  };
  const applicationBefore = check.requiresApplicationIdentity
    ? await applicationRevision(applicationBase)
    : null;
  const result =
    check.requiresApplicationIdentity && applicationBefore !== sourceBefore.commit
      ? {
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          exitCode: 127,
          signal: null,
          timedOut: false,
          truncated: false,
          cancelled: false,
        }
      : await capture(
          check.command[0] === "node" ? process.execPath : check.command[0],
          check.command.slice(1),
          {
            cwd: check.cwd ? join(cwd, check.cwd) : cwd,
            env: childEnv,
            timeoutMs: check.timeoutMs,
            signal,
            graceMs: check.graceMs,
          },
        );
  const applicationAfter = check.requiresApplicationIdentity
    ? await applicationRevision(applicationBase)
    : null;
  const finishedAt = new Date().toISOString();
  const sourceAfter = await inspectSource(cwd);
  const toolVersions = { node: process.version };
  for (const [tool, location] of Object.entries(check.tools || {})) {
    try {
      const version = JSON.parse(await readFile(join(cwd, String(location)), "utf8")).version;
      if (/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) toolVersions[tool] = version;
    } catch (_error) {
      /* Missing tool is exposed by the command outcome. */
    }
  }
  const receipt = {
    schemaVersion: 1,
    checkId: check.id,
    command: check.command,
    sourceBefore,
    sourceAfter,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    truncated: result.truncated,
    cancelled: result.cancelled,
    toolVersions,
    ...(check.requiresApplicationIdentity
      ? { application: { before: applicationBefore, after: applicationAfter } }
      : {}),
    artifacts: {
      stdout: { sha256: digest(result.stdout), bytes: result.stdout.length },
      stderr: { sha256: digest(result.stderr), bytes: result.stderr.length },
    },
  };
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const stream of ["stdout", "stderr"])
    await writeFile(join(output, `${check.id}.${stream}`), result[stream], {
      mode: 0o600,
      flag: "wx",
    });
  await writeFile(
    join(output, `${check.id}.receipt.json`),
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return { receipt, stdout: result.stdout, stderr: result.stderr };
}

const externalChecks = [
  ["physical-acceptance", "Physical device, enrollment and ownership acceptance"],
  ["provider-acceptance", "Selected Wallet, promotional messaging and POS provider acceptance"],
  ["security-acceptance", "Independent security review and release security gates"],
  ["operations-acceptance", "Deployment, restore, monitoring and owner pilot approval"],
];

export function buildReport({ source, revision, results, generatedAt = new Date().toISOString() }) {
  const sourceCheck = {
    id: "source-identity",
    title: "Exact clean release source",
    category: "static",
    status: source.commit === revision && source.clean ? "passed" : "failed",
    reason:
      source.commit === revision && source.clean
        ? "exact_clean_revision"
        : "source_mismatch_or_dirty",
  };
  const code = [sourceCheck, ...results];
  const codeReadiness = code.some((row) => row.status === "failed")
    ? "failed"
    : code.some((row) => row.status !== "passed")
      ? "not_tested"
      : "passed";
  return {
    schemaVersion: 1,
    generatedAt,
    requestedRevision: revision,
    source,
    evidenceMaxAgeHours: MAX_AGE_MS / 3600000,
    codeReadiness,
    pilotReadiness: codeReadiness === "failed" ? "failed" : "not_tested",
    scope: "Website/backend code evidence; native apps and external acceptance are not certified.",
    checks: [
      ...code,
      ...externalChecks.map(([id, title]) => ({
        id,
        title,
        category: "external",
        status: "not_tested",
        reason: "external_acceptance_required",
      })),
    ],
  };
}

export function renderMarkdown(report) {
  const lines = [
    "# Release readiness",
    "",
    `Code readiness: ${report.codeReadiness}`,
    `Pilot readiness: ${report.pilotReadiness}`,
    "",
    `Revision: \`${report.requestedRevision}\``,
    `Content SHA-256: \`${report.source.contentSha256}\``,
    `Generated: ${report.generatedAt}`,
    "",
    report.scope,
    "",
    "| Check | Scope | Status | Evidence |",
    "| --- | --- | --- | --- |",
  ];
  for (const check of report.checks) {
    const counts = check.counts;
    const details = counts
      ? `${counts.pass}/${counts.tests} passed; ${counts.fail} failed; ${counts.skipped} skipped; ${counts.cancelled} cancelled; ${counts.todo} todo`
      : check.reason;
    lines.push(`| ${check.title} | ${check.category} | ${check.status} | ${details} |`);
  }
  lines.push("", "## Execution evidence", "");
  for (const check of report.checks.filter((row) => row.startedAt)) {
    lines.push(
      `### ${check.title}`,
      "",
      `Command: \`${check.command.join(" ")}\``,
      `Tools: ${Object.entries(check.toolVersions)
        .map(([name, version]) => `${name} ${version}`)
        .join(", ")}`,
      `Time: ${check.startedAt} to ${check.finishedAt} (${check.durationMs} ms); exit: ${check.exitCode ?? "none"}; signal: ${check.signal ?? "none"}`,
      ...(check.application
        ? [
            `Application build SHA before/after: ${check.application.before ?? "unverified"} / ${check.application.after ?? "unverified"}`,
          ]
        : []),
      `Reporter SHA-256: \`${check.artifacts.stdout.sha256}\`; stderr SHA-256: \`${check.artifacts.stderr.sha256}\``,
      "",
    );
  }
  lines.push(
    "Raw private artifacts can contain test diagnostics. This report omits environment values, raw output, test names and error messages.",
    "Static checks prove only the stated repository/tool conditions. External acceptance remains required even when code readiness passes.",
    "",
  );
  return lines.join("\n");
}
