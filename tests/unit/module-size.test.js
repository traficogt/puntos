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
      ["src/app/routes/health-routes.js", 80],
      ["src/app/routes/observability-router.js", 420],
      ["src/app/services/gamification-service.js", 40],
      ["public/styles.css", 20],
      ["public/styles/analytics-visuals.css", 400],
      ["public/admin-dashboard.html", 180],
      ["public/admin-dashboard/fragments/program.html", 180],
      ["public/admin-dashboard/fragments/analytics.html", 180],
      ["public/admin-dashboard/modules/analytics/dashboard.js", 140],
      ["public/admin-dashboard/core.js", 380],
      ["public/admin-dashboard/tab-controller.js", 100],
      ["public/admin-dashboard/session-controller.js", 80],
      ["public/admin-dashboard/modules/program.js", 80],
      ["public/admin-dashboard/modules/program-actions.js", 180],
      ["public/admin-dashboard/modules/program-listeners.js", 90],
      ["src/app/routes/admin/program.js", 40],
      ["src/app/routes/admin/program-support.js", 140],
      ["src/app/routes/admin/program-config-routes.js", 160],
      ["src/app/routes/admin/program-campaign-routes.js", 80],
      ["src/app/routes/admin/program-external-routes.js", 90],
      ["src/app/routes/gamification-routes.js", 40],
      ["src/app/routes/gamification-support.js", 120],
      ["src/app/routes/gamification-customer-routes.js", 90],
      ["src/app/routes/gamification-admin-routes.js", 220],
      ["src/app/routes/super-routes.js", 420],
      ["src/app/repositories/analytics-repository.js", 420]
    ];

    for (const [filePath, maxLines] of limits) {
      assert.ok(lineCount(filePath) <= maxLines, `${filePath} should stay under ${maxLines} lines`);
    }
  });
});
