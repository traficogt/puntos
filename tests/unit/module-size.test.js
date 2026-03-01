import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function lineCount(relPath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
  return content.split("\n").length;
}

describe("module size guardrails", () => {
  it("keeps the main refactored hotspots below their size thresholds", () => {
    /** @type {Array<[string, number]>} */
    const limits = [
      ["src/app/database.js", 40],
      ["src/app/routes/health-routes.js", 40],
      ["src/app/routes/observability.js", 60],
      ["src/app/services/gamification-service.js", 40],
      ["public/admin-dashboard/modules/analytics/dashboard.js", 140],
      ["public/admin-dashboard/core.js", 300],
      ["public/admin-dashboard/modules/program.js", 240]
    ];

    for (const [filePath, maxLines] of limits) {
      assert.ok(lineCount(filePath) <= maxLines, `${filePath} should stay under ${maxLines} lines`);
    }
  });
});
