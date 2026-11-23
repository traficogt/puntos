/* eslint-disable security/detect-non-literal-fs-filename -- Paths are repository-owned test artifacts or this run's temporary directory. */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedEnvironment, runCommand } from "./run-domain-integration-isolated.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const postgresImage =
  "postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139";
const nodeImage =
  "node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9";
export const expectedWebkitTests = ["desktop", "mobile"].flatMap((layout) => [
  `${layout}: enrollment, QR, reload and returning access preserve the customer card`,
  `${layout}: phone correction and invalid OTP keep enrollment recoverable`,
]);

/** @param {any} report @param {{listed?: boolean}} options */
export function validateWebkitReport(report, { listed = false } = {}) {
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs || [])
      for (const test of spec.tests || []) {
        tests.push({ name: `${suite.title}: ${spec.title}`, ...test });
      }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report?.suites || []) visit(suite);
  if (report?.errors?.length) throw new Error("WebKit report contains runner errors");
  if (
    tests.length !== expectedWebkitTests.length ||
    JSON.stringify(tests.map((test) => test.name).sort()) !==
      JSON.stringify([...expectedWebkitTests].sort())
  ) {
    throw new Error(
      `WebKit selection mismatch: expected ${expectedWebkitTests.length} named tests, found ${tests.length}`,
    );
  }
  for (const test of tests) {
    if (test.projectName !== "webkit" || test.expectedStatus !== "passed")
      throw new Error(`WebKit test must run and pass: ${test.name}`);
    if (
      !listed &&
      (test.status !== "expected" ||
        test.results?.length !== 1 ||
        test.results[0].status !== "passed" ||
        test.results[0].retry !== 0)
    ) {
      throw new Error(`WebKit test failed, skipped or retried: ${test.name}`);
    }
  }
  return {
    tests: tests.length,
    ...(listed ? {} : { passed: tests.length, skipped: 0, retries: 0 }),
  };
}

/** @param {NodeJS.ProcessEnv} inherited */
export function webkitEnvironment(inherited) {
  return {
    ...Object.fromEntries(
      ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "CI"]
        .filter((key) => inherited[key] !== undefined)
        .map((key) => [key, inherited[key]]),
    ),
    NODE_ENV: "test",
    E2E_WEBKIT: "1",
    E2E_WEBKIT_ISOLATED: "1",
    PLAYWRIGHT_BROWSERS_PATH: "0",
  };
}

async function main() {
  if (process.argv.length > 2)
    throw new Error(
      "The WebKit gate takes no filters or target overrides; it runs all four isolated tests.",
    );
  const workdir = await mkdtemp(join(tmpdir(), "pf-webkit-"));
  const artifacts = join(root, "test-results/webkit");
  await mkdir(artifacts, { recursive: true });
  const env = webkitEnvironment(process.env);
  const password = randomBytes(32).toString("hex");
  const name = `pf-webkit-${process.pid}-${randomBytes(6).toString("hex")}`;
  const abort = new AbortController();
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    abort.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const containers = [];
  let network,
    api,
    exitCode = 0;
  let upstreamHost;
  // Docker internal networks do not reliably support published ports. A host
  // loopback relay reaches only this run's inspected container, with no egress
  // route added to the fixture network and no externally listening application.
  const relay = createServer((incoming, outgoing) => {
    if (!upstreamHost) {
      outgoing.writeHead(503).end();
      return;
    }
    const upstream = request(
      {
        hostname: upstreamHost,
        port: 3001,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  const redact = (value) => value.replaceAll(password, "[redacted]");
  async function docker(args, checked = true, cleanup = false) {
    const result = await runCommand("docker", ["--context", "default", ...args], {
      cwd: workdir,
      env: { ...env, POSTGRES_PASSWORD: password },
      timeoutMs: 180000,
      ...(cleanup ? {} : { signal: abort.signal }),
    });
    if (checked && result.code) throw new Error(redact(result.output));
    return result;
  }
  const cli = join(root, "node_modules/playwright/cli.js");
  const selection = [
    "test",
    "--config",
    join(root, "playwright.config.mjs"),
    "--project=webkit",
    "--retries=0",
    "--workers=1",
  ];
  try {
    // cwd-based dotenv loading sees an empty temporary directory, never a checkout .env.
    for (const directory of ["tests", "public", "node_modules"])
      await symlink(join(root, directory), join(workdir, directory), "dir");
    const listed = await runCommand(
      process.execPath,
      [cli, ...selection, "--list", "--reporter=json"],
      { cwd: workdir, env },
    );
    if (listed.code) throw new Error(listed.output);
    const selected = validateWebkitReport(JSON.parse(listed.stdout), { listed: true });
    console.log(`[webkit] Selected ${selected.tests} tests; retries and skips are forbidden.`);

    network = (await docker(["network", "create", "--internal", name])).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(network))
      throw new Error("Docker did not return the fixture network ID");
    const db = (
      await docker([
        "create",
        "--name",
        `${name}-db`,
        "--network",
        network,
        "--network-alias",
        "fixture-db",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_DB=webkit_test",
        postgresImage,
      ])
    ).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(db))
      throw new Error("Docker did not return the fixture database ID");
    containers.push(db);
    await docker(["start", db]);
    let ready = false;
    for (let attempt = 0; attempt < 60 && !interrupted; attempt++) {
      if (
        (
          await docker(
            ["exec", db, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "webkit_test"],
            false,
          )
        ).code === 0
      ) {
        ready = true;
        break;
      }
      await delay(500);
    }
    if (!ready) throw new Error("Fixture PostgreSQL did not become ready");
    await new Promise((readyRelay, reject) => {
      relay.once("error", reject);
      relay.listen(0, "127.0.0.1", () => readyRelay(undefined));
    });
    const port = /** @type {import('node:net').AddressInfo} */ (relay.address()).port;
    const baseURL = `http://127.0.0.1:${port}`;
    const appEnv = {
      ...isolatedEnvironment({}, { port: "5432", password, database: "webkit_test" }),
      DB_HOST: "fixture-db",
      PORT: "3001",
      APP_ORIGIN: baseURL,
      CORS_ORIGIN: baseURL,
      MARKETING_ORIGIN: baseURL,
      IN_PROCESS_WORKERS: "false",
      AUTO_APPLY_MIGRATIONS: "true",
      LOG_LEVEL: "warn",
      TRUST_PROXY: "1",
    };
    const mounts = ["src", "public", "node_modules", "package.json"].flatMap((entry) => [
      "--mount",
      `type=bind,src=${join(root, entry)},dst=/app/${entry},readonly`,
    ]);
    api = (
      await docker([
        "create",
        "--name",
        `${name}-api`,
        "--network",
        network,
        "--workdir",
        "/app",
        "--read-only",
        "--tmpfs",
        "/tmp",
        ...mounts,
        ...Object.entries(appEnv).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        nodeImage,
        "node",
        "src/app/server.js",
      ])
    ).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(api)) throw new Error("Docker did not return the fixture API ID");
    containers.push(api);
    await docker(["start", api]);
    upstreamHost = (
      await docker([
        "inspect",
        "--format",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
        api,
      ])
    ).stdout.trim();
    if (isIP(upstreamHost) !== 4) throw new Error("Expected the fixture container IPv4 address");
    ready = false;
    for (let attempt = 0; attempt < 120 && !interrupted; attempt++) {
      try {
        if ((await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Only the newly allocated loopback fixture is polled. */
      }
      await delay(500);
    }
    if (!ready) throw new Error("Fixture API did not become ready");
    const reportPath = join(artifacts, "report.json");
    await rm(reportPath, { force: true });
    console.log(
      "[webkit] Running against a disposable fixture; development OTP, no providers or workers.",
    );
    const result = await runCommand(
      process.execPath,
      [cli, ...selection, "--reporter=line,json", "--output", join(artifacts, "traces")],
      {
        cwd: workdir,
        env: { ...env, E2E_BASE_URL: baseURL, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
        timeoutMs: 300000,
        signal: abort.signal,
      },
    );
    console.log(redact(result.output));
    if (result.code) throw new Error(`WebKit exited with code ${result.code}`);
    console.log(
      JSON.stringify(validateWebkitReport(JSON.parse(await readFile(reportPath, "utf8")))),
    );
  } catch (error) {
    console.error(`[webkit] ${redact(error.message)}`);
    exitCode = 1;
  } finally {
    relay.closeAllConnections();
    await new Promise((resolveClosed) => relay.close(() => resolveClosed(undefined)));
    if (api && containers.includes(api)) {
      const logs = await docker(["logs", api], false, true);
      await writeFile(join(artifacts, "api.log"), redact(logs.output));
      if (exitCode) console.error(redact(logs.output).slice(-6000));
    }
    for (const id of containers.reverse()) {
      const removed = await docker(["rm", "--force", "--volumes", id], false, true);
      if (removed.code) {
        console.error(`[webkit] Fixture container cleanup failed: ${removed.output}`);
        exitCode = 1;
      }
    }
    if (network && /^[a-f0-9]{64}$/.test(network)) {
      const removed = await docker(["network", "rm", network], false, true);
      if (removed.code) {
        console.error(`[webkit] Fixture network cleanup failed: ${removed.output}`);
        exitCode = 1;
      }
    }
    await rm(workdir, { recursive: true, force: true });
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  return interrupted ? 130 : exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
