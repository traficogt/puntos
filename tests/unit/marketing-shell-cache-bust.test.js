import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("marketing entrypoint avoids service-worker registration and uses versioned assets", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  // Versions are the first eight hex digits of each file's SHA-256 (npm run sw:build).
  assert.match(html, /href="\/styles\/marketing\.css\?v=[0-9a-f]{8}"/);
  assert.match(html, /src="\/index\.js\?v=[0-9a-f]{8}"/);
  assert.doesNotMatch(js, /registerServiceWorker\(/);
});
