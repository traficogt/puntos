#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";

// Reuse the established PWA fixture and Playwright suites; only select their JSON reporter.
const mode = process.argv[2];
if (!["pwa", "e2e", "staff"].includes(mode) || !process.env.READINESS_BROWSER_OUTPUT)
  throw new Error("Readiness browser mode and output are required");
let server;
try {
  if (mode === "pwa") {
    const { startPwaStaticServer } =
      await import("../../tests/integration/helpers/pwa-static-server.js");
    server = await startPwaStaticServer();
  } else if (mode === "e2e") {
    const base = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3001");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error("Use an isolated loopback application");
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, ...(server ? { PWA_BASE_URL: server.baseUrl } : {}) };
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  const suites =
    mode === "staff"
      ? ["tests/e2e/staff-offline.spec.js"]
      : mode === "pwa"
        ? ["tests/e2e/pwa.spec.js"]
        : [
            "tests/e2e/smoke.spec.js",
            "tests/e2e/auth-security.spec.js",
            "tests/e2e/flows.spec.js",
            "tests/e2e/adversarial.spec.js",
            "tests/e2e/visual.spec.js",
          ];
  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(process.cwd(), "node_modules/playwright/cli.js"),
        "test",
        ...suites,
        ...(mode === "staff"
          ? ["--project=chromium", "--project=firefox"]
          : ["--project=chromium"]),
        "--reporter=json",
        "--retries=0",
        "--forbid-only",
        `--output=${process.env.READINESS_BROWSER_OUTPUT}`,
      ],
      { env, stdio: "inherit" },
    );
    child.on("error", () => resolve(127));
    child.on("exit", (exitCode, signal) => resolve(signal ? 130 : (exitCode ?? 127)));
  });
  process.exitCode = code;
} finally {
  await server?.stop();
}
