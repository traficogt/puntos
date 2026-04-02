import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("marketing entrypoint avoids service-worker registration and uses versioned assets", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  assert.match(html, /href="\/styles\.css\?v=\d+"/);
  assert.match(html, /src="\/index\.js\?v=\d+"/);
  assert.doesNotMatch(js, /registerServiceWorker\(/);
});
