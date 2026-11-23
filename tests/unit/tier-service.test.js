import assert from "node:assert/strict";
import test from "node:test";
import { TierService } from "../../src/app/services/tier-service.js";
import { runWithDbContext } from "../../src/app/database.js";

// GET /api/admin/tiers feeds the owner editors (web/merchant OwnerTiers, vanilla "Niveles").
// The list used to return statistics only (id, name, tier_level, customer_count, avg_points,
// total_points), so editors prefilled undefined. The read now carries the full rule as well.
const RULE_COLUMNS = [
  "min_points",
  "min_spend",
  "min_visits",
  "points_multiplier",
  "perks",
  "color",
  "icon_url",
  "active",
];
const STAT_COLUMNS = ["customer_count", "avg_points", "total_points"];
const row = {
  id: "tier-1",
  business_id: "business-a",
  name: "Oro",
  tier_level: 3,
  min_points: 5000,
  min_spend: null,
  min_visits: null,
  points_multiplier: "1.50",
  perks: ["Puntos ×1.5"],
  color: "#D4AF37",
  icon_url: "🥇",
  active: true,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T00:00:00.000Z",
  customer_count: "12",
  avg_points: "5400.5",
  total_points: "64806",
};

async function listWithFakeClient() {
  const queries = [];
  const tiers = await runWithDbContext(
    {
      client: {
        query: async (sql, params) => {
          queries.push({ sql, params });
          return { rows: [row] };
        },
      },
    },
    () => TierService.getBusinessTiersWithStats("business-a"),
  );
  return { tiers, queries };
}

test("tier list selects the rule columns alongside the statistics, scoped to the business", async () => {
  const { queries } = await listWithFakeClient();
  assert.equal(queries.length, 1);
  const { sql, params } = queries[0];
  assert.deepEqual(params, ["business-a"]);
  assert.match(sql, /FROM loyalty_tiers lt/);
  assert.match(sql, /WHERE lt\.business_id = \$1/);
  for (const column of RULE_COLUMNS) {
    assert.match(sql, new RegExp(`lt\\.${column}\\b`), `${column} must be selected`);
  }
  assert.match(sql, /COUNT\(ct\.customer_id\) as customer_count/);
  assert.match(sql, /AVG\(cb\.points\) as avg_points/);
  assert.match(sql, /SUM\(cb\.points\) as total_points/);
  // Grouping by the primary key is what allows the rule columns next to the aggregates.
  assert.match(sql, /GROUP BY lt\.id\s+ORDER BY lt\.tier_level ASC/);
});

test("tier list keeps the historical statistic fields and adds the rule fields", async () => {
  const { tiers } = await listWithFakeClient();
  assert.equal(tiers.length, 1);
  for (const field of ["id", "name", "tier_level", ...STAT_COLUMNS, ...RULE_COLUMNS]) {
    assert.ok(field in tiers[0], `${field} present in the response row`);
  }
  assert.equal(tiers[0].min_points, 5000);
  assert.deepEqual(tiers[0].perks, ["Puntos ×1.5"]);
  assert.equal(tiers[0].customer_count, "12");
});
