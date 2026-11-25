import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { before, after, describe, it } from "node:test";
import pg from "pg";

// Run only through the disposable domain runner; never use a developer's .env.
const url = process.env.MERCHANT_SCALE_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const now = new Date("2026-11-16T18:00:00Z");
const businessId = randomUUID(),
  otherBusiness = randomUUID(),
  staffId = randomUUID();
let client, database, directory, overview, audience, imports;
const measurements = [];
const plans = [];
let capturedQueries;
let queryCount = 0;
const query = async (sql, values) => {
  queryCount++;
  capturedQueries?.push({ sql, values });
  return client.query(sql, values);
};
const deps = {
  query,
  transaction: async (fn) => {
    await client.query("BEGIN");
    try {
      const value = await fn({ query });
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  },
};
async function profileReads(name, operation) {
  capturedQueries = [];
  let observed;
  try {
    await operation();
    observed = capturedQueries;
  } finally {
    capturedQueries = undefined;
  }
  for (const { sql, values } of observed) {
    assert.match(sql.trim(), /^(SELECT|WITH)\b/i);
    const plan = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values))
      .rows[0]["QUERY PLAN"][0];
    const nodes = [];
    const visit = (node) => {
      nodes.push({
        node: node["Node Type"],
        rows: node["Actual Rows"],
        loops: node["Actual Loops"],
      });
      (node.Plans || []).forEach(visit);
    };
    visit(plan.Plan);
    plans.push({
      name,
      execution_ms: plan["Execution Time"],
      shared_hit_blocks: plan.Plan["Shared Hit Blocks"],
      shared_read_blocks: plan.Plan["Shared Read Blocks"],
      nodes,
    });
  }
}
async function measure(name, operation, { samples = 5, budgetMs = 3000 } = {}) {
  const times = [],
    counts = [];
  let result;
  for (let index = 0; index < samples; index++) {
    const start = performance.now(),
      beforeCount = queryCount;
    result = await operation();
    times.push(performance.now() - start);
    counts.push(queryCount - beforeCount);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const metric = {
    name,
    samples,
    milliseconds: times.map((n) => Math.round(n)),
    p95_ms: Math.round(sorted[Math.ceil(samples * 0.95) - 1]),
    service_query_counts: counts,
    budget_ms: budgetMs,
  };
  measurements.push(metric);
  assert.ok(
    metric.p95_ms < budgetMs,
    `${name} exceeded its generous regression budget: ${JSON.stringify(metric)}`,
  );
  return result;
}

suite("merchant scale with fictional customers and the complete schema", () => {
  before(async () => {
    assert.equal(process.env.PF_DOMAIN_ISOLATED, "1");
    assert.equal(existsSync(".env"), false);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.ok(parsed.port && parsed.port !== "5432");
    assert.equal(parsed.pathname, "/merchant_scale_test");
    client = new pg.Client({ connectionString: url });
    await client.connect();
    database = await import("../../src/app/database.js");
    ({ CustomerDirectoryRepo: directory } =
      await import("../../src/app/repositories/customer-directory-repository.js"));
    ({ getMerchantOverview: overview } =
      await import("../../src/app/services/merchant-overview-service.js"));
    ({ previewCustomerAudience: audience } =
      await import("../../src/app/services/customer-audience-service.js"));
    imports = await import("../../src/app/services/customer-import-job-service.js");
    await client.query(
      `INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json)
      SELECT id,'Fictional scale fixture',id::text,id::text || '@example.invalid','fixture','VISIT',
      '{"points_per_visit":10,"region":{"country":"GT","currency":"GTQ","timezone":"America/Guatemala"}}'::jsonb
      FROM unnest($1::uuid[]) AS id`,
      [[businessId, otherBusiness]],
    );
    await client.query(
      "INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Fictional owner','OWNER','fixture')",
      [staffId, businessId],
    );
    /** @type {Array<[string,number,string]>} */
    const seeds = [
      [businessId, 10000, "51"],
      [otherBusiness, 2000, "52"],
    ];
    for (const [tenant, count, prefix] of seeds) {
      await client.query(
        `INSERT INTO customers(id,business_id,phone,name,created_at)
        SELECT md5($1::text || ':' || i)::uuid,$1::uuid,'502' || $3 || lpad(i::text,6,'0'),
        'Fictional member ' || lpad(i::text,5,'0'),$4::timestamptz-interval '90 days'
        FROM generate_series(1,$2::int) i`,
        [tenant, count, prefix, now],
      );
      await client.query(
        `INSERT INTO customer_balances(customer_id,points,pending_points,lifetime_points)
        SELECT id,100,0,100 FROM customers WHERE business_id=$1`,
        [tenant],
      );
      for (let start = 1; start <= count * 10; start += 1000)
        await client.query(
          `INSERT INTO transactions(id,business_id,customer_id,points,amount_q,visits,type,source,status,created_at)
        SELECT md5($1::text || ':tx:' || i)::uuid,$1::uuid,md5($1::text || ':' || ((i-1)%$2::int+1))::uuid,
        10,40,1,'PURCHASE','online','POSTED',$3::timestamptz-(1+(i-1)%28)*interval '24 hours'
        FROM generate_series($4::int,$4::int+999) i`,
          [tenant, count, now, start],
        );
    }
    await client.query(
      "ANALYZE customers; ANALYZE customer_balances; ANALYZE transactions; ANALYZE customer_marketing_preferences",
    );
  });
  after(async () => {
    await client?.end();
    await database?.closeDatabase();
  });

  it("dashboard aggregates 100,000 purchases without including the second business", async () => {
    const result = await measure("overview-30-days", () =>
      overview({ businessId, days: 30, now, timezone: "America/Guatemala" }, query),
    );
    assert.equal(result.current.purchases, 100000);
    assert.equal(result.current.recorded_sales_q, 4000000);
    assert.equal(result.current.active_customers, 10000);
    assert.equal(result.current.repeat_customers, 10000);
    assert.equal(
      result.daily.reduce((sum, row) => sum + row.purchases, 0),
      100000,
    );
    await profileReads("overview-30-days", () =>
      overview({ businessId, days: 30, now, timezone: "America/Guatemala" }, query),
    );
  });
  it("customer pagination, literal searches and deep pages remain bounded and tenant-scoped", async () => {
    const list = (options) =>
      database.runWithDbContext({ client: { query }, tenantId: businessId }, () =>
        directory.list({ businessId, ...options }),
      );
    const first = await measure("customer-directory-first-page", () => list({}));
    assert.equal(first.total, 10000);
    assert.equal(first.customers.length, 25);
    const end = await measure("customer-directory-last-page", () => list({ page: 400 }));
    assert.equal(end.customers.length, 25);
    assert.equal(
      first.customers.some((row) => end.customers.some((last) => last.id === row.id)),
      false,
    );
    const matches = await measure("customer-directory-search", () => list({ q: "01000" }));
    assert.equal(
      matches.customers.filter((row) => row.name === "Fictional member 01000").length,
      1,
    );
    assert.equal((await list({ q: "%" })).total, 0);
    assert.equal((await list({ q: "50252" })).total, 0);
    assert.equal((await list({ page: 401 })).total, 10000);
    assert.deepEqual((await list({ page: 401 })).customers, []);
    await profileReads("customer-directory-search", () => list({ q: "01000" }));
  });
  it("directory hides deleted/foreign profiles and rejects stale name edits", async () => {
    const removed = randomUUID();
    await query(
      "INSERT INTO customers(id,business_id,phone,name,deleted_at) VALUES($1,$2,'50254999999','Deleted fixture',now())",
      [removed, businessId],
    );
    const context = (fn) =>
      database.runWithDbContext({ client: { query }, tenantId: businessId }, fn);
    const foreign = (
      await query("SELECT id FROM customers WHERE business_id=$1 LIMIT 1", [otherBusiness])
    ).rows[0].id;
    assert.equal(await context(() => directory.get({ businessId, customerId: removed })), null);
    assert.equal(await context(() => directory.get({ businessId, customerId: foreign })), null);
    const customer = (
      await context(() => directory.list({ businessId, q: "Fictional member 00001" }))
    ).customers[0];
    const changed = await context(() =>
      directory.updateName({
        businessId,
        customerId: customer.id,
        name: "Renamed fictional member",
        previousName: customer.name,
      }),
    );
    assert.equal(changed.name, "Renamed fictional member");
    await assert.rejects(
      context(() =>
        directory.updateName({
          businessId,
          customerId: customer.id,
          name: "Stale overwrite",
          previousName: customer.name,
        }),
      ),
      { statusCode: 409 },
    );
    await assert.rejects(
      context(() =>
        directory.updateName({
          businessId,
          customerId: foreign,
          name: "Foreign edit",
          previousName: null,
        }),
      ),
      { statusCode: 404 },
    );
    assert.equal((await context(() => directory.list({ businessId }))).total, 10000);
  });
  it("audience preview evaluates real transaction history and returns only a bounded preview", async () => {
    const definition = {
      window_days: 30,
      include: {
        match: "all",
        rules: [
          { field: "purchase_count", operator: "gte", value: 10 },
          { field: "spend_q", operator: "gte", value: 400 },
        ],
      },
      exclude: { match: "any", rules: [] },
    };
    const result = await measure("audience-transaction-preview", () =>
      audience({ businessId, definition, limit: 10, now }, { query }),
    );
    assert.equal(result.total, 10000);
    assert.equal(result.customers.length, 10);
    assert.equal(result.contactable_count, 0);
    await profileReads("audience-transaction-preview", () =>
      audience({ businessId, definition, limit: 10, now }, { query }),
    );
  });
  it("previews and processes the supported 5,000-row import without duplicate opening balances", async () => {
    const csv =
      "phone,name,points\n" +
      Array.from(
        { length: 5000 },
        (_, i) => `+50253${String(i).padStart(6, "0")},Fictional import ${i},2`,
      ).join("\n");
    const input = {
      csv,
      columns: { phone: "phone", name: "name", points: "points" },
      existing_policy: "skip",
    };
    const preview = await measure("import-preview-5000", () =>
      imports.previewCustomerImportJob({ businessId, input }, deps),
    );
    assert.equal(preview.can_commit, true);
    assert.equal(preview.rows.length, 5000);
    const created = await imports.createCustomerImportJob(
      {
        businessId,
        staffId,
        input: {
          ...input,
          request_id: randomUUID(),
          label: "Fictional scale import",
          confirmed: true,
        },
      },
      deps,
    );
    const args = { businessId, importJobId: created.job.id };
    let chunks = 0;
    const final = await measure(
      "import-process-5000",
      async () => {
        let result;
        do {
          result = await imports.processCustomerImportChunk(args, deps);
          chunks++;
        } while (!result.terminal);
        return result;
      },
      { samples: 1, budgetMs: 60000 },
    );
    // 5,000 rows in 200-row chunks (IMPORT_CHUNK_ROWS).
    assert.equal(chunks, 25);
    assert.equal(final.job.status, "completed");
    assert.equal(final.job.imported, 5000);
    assert.equal(Number(final.job.opening_points), 10000);
    assert.equal((await imports.processCustomerImportChunk(args, deps)).job.imported, 5000);
    const totals = (
      await query(
        `SELECT count(*)::int AS rows,sum(points)::int AS points
      FROM transactions WHERE business_id=$1 AND type='OPENING_BALANCE'`,
        [businessId],
      )
    ).rows[0];
    assert.deepEqual(totals, { rows: 5000, points: 10000 });
    async function importedBalances() {
      return (
        await query(
          `SELECT count(*)::int AS customers,count(DISTINCT c.phone)::int AS phones,
        count(DISTINCT t.customer_id)::int AS ledger_customers,sum(b.points)::int AS points,
        sum(b.pending_points)::int AS pending,sum(b.lifetime_points)::int AS lifetime,
        bool_and(b.points=2 AND b.pending_points=0 AND b.lifetime_points=2) AS correct
        FROM customers c JOIN customer_balances b ON b.customer_id=c.id
        JOIN transactions t ON t.customer_id=c.id AND t.business_id=c.business_id AND t.type='OPENING_BALANCE'
        WHERE c.business_id=$1 AND c.phone LIKE '50253%'`,
          [businessId],
        )
      ).rows[0];
    }
    const expected = {
      customers: 5000,
      phones: 5000,
      ledger_customers: 5000,
      points: 10000,
      pending: 0,
      lifetime: 10000,
      correct: true,
    };
    assert.deepEqual(await importedBalances(), expected);
    await imports.processCustomerImportChunk(args, deps);
    assert.deepEqual(await importedBalances(), expected);
    assert.deepEqual(
      (
        await query(
          `SELECT count(*)::int AS customers,bool_and(points=100 AND pending_points=0 AND lifetime_points=100) AS unchanged
      FROM customers c JOIN customer_balances b ON b.customer_id=c.id WHERE c.business_id=$1 AND c.phone LIKE '50251%'`,
          [businessId],
        )
      ).rows[0],
      { customers: 10000, unchanged: true },
    );
    assert.equal(
      (
        await query("SELECT count(*)::int AS total FROM customers WHERE business_id=$1", [
          otherBusiness,
        ])
      ).rows[0].total,
      2000,
    );
  });
  it("records the measured dataset and regression budgets without claiming a production SLA", (t) => {
    assert.equal(measurements.length, 7);
    assert.equal(plans.length, 5);
    t.diagnostic(
      JSON.stringify({
        kind: "merchant-scale-benchmark",
        dataset: {
          customers: 10000,
          purchases: 100000,
          other_customers: 2000,
          other_purchases: 20000,
          import_rows: 5000,
        },
        measurements,
        plans,
      }),
    );
  });
});
