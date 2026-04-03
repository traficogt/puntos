import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/admin-dashboard.html");

test("admin dashboard exposes a growth-first executive summary layer", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /admin-growth-summary/);
  assert.match(html, /id="adminGrowthBoard"/);
  assert.match(html, /id="adminExecutiveNarrative"/);
  assert.match(html, /id="adminSuggestedActions"/);
  assert.match(html, /admin-detail-band/);
});
