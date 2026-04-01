import { spawn } from "node:child_process";
import path from "node:path";
import { startPwaStaticServer } from "../../tests/integration/helpers/pwa-static-server.js";

const server = await startPwaStaticServer();

try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "node_modules", "playwright", "cli.js"),
        "test",
        "tests/e2e/pwa.spec.js",
        "--project=chromium"
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0",
          PWA_BASE_URL: server.baseUrl
        },
        stdio: "inherit"
      }
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`Playwright PWA suite exited with signal ${signal}`));
        return;
      }
      reject(new Error(`Playwright PWA suite exited with code ${code ?? "unknown"}`));
    });
  });
} finally {
  await server.stop();
}
