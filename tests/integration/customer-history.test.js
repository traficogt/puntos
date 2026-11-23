import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { TxnRepo } from "../../src/app/repositories/transaction-repository.js";
import { RedemptionRepo } from "../../src/app/repositories/redemption-repository.js";
import { runWithDbContext } from "../../src/app/database.js";

const url = process.env.CUSTOMER_HISTORY_TEST_DB_URL;
test(
  "browser history scopes transactions, redemptions and provenance evidence in PostgreSQL",
  { skip: !url },
  async () => {
    const parsed = new URL(url);
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.ok(parsed.port && parsed.port !== "5432");
    assert.equal(parsed.pathname, "/customer_history_test");
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    const business = randomUUID(),
      otherBusiness = randomUUID(),
      customer = randomUUID(),
      colleague = randomUUID(),
      foreignCustomer = randomUUID();
    const reward = randomUUID(),
      foreignReward = randomUUID();
    async function txn(extra = {}) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO transactions(id,business_id,customer_id,type,points,source,status,meta,original_transaction_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          extra.business || business,
          extra.customer || customer,
          extra.type || "PURCHASE",
          extra.points ?? 20,
          extra.source || "online",
          extra.status || "POSTED",
          { note: "PRIVATE_NOTE", staff_cost: 50, ...extra.meta },
          extra.original || null,
        ],
      );
      return id;
    }
    try {
      await db.query(`CREATE TABLE transactions(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,branch_id uuid,staff_user_id uuid,
      type text,points integer,amount_q numeric(10,2) DEFAULT 0,visits integer DEFAULT 0,items integer DEFAULT 0,source text,status text,
      meta jsonb,original_transaction_id uuid,reversed_transaction_id uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE rewards(id uuid PRIMARY KEY,business_id uuid,name text);
      CREATE TABLE redemptions(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,branch_id uuid,reward_id uuid,
      code text,points_cost integer,status text,created_at timestamptz DEFAULT now(),redeemed_at timestamptz);`);
      await db.query("INSERT INTO rewards VALUES($1,$2,'Café'),($3,$4,'PRIVATE_FOREIGN_REWARD')", [
        reward,
        business,
        foreignReward,
        otherBusiness,
      ]);
      const own = await txn({ type: "ACHIEVEMENT", status: "REVERSED" });
      const sameBusinessOtherCustomer = await txn({ customer: colleague });
      const otherTenant = await txn({ business: otherBusiness, customer: foreignCustomer });
      const linked = await txn({
        source: "reversal",
        type: "ACHIEVEMENT",
        points: -20,
        original: own,
      });
      const badCustomerLink = await txn({
        source: "reversal",
        type: "ACHIEVEMENT",
        points: -20,
        original: sameBusinessOtherCustomer,
      });
      const badTenantLink = await txn({
        source: "reversal",
        type: "ACHIEVEMENT",
        points: -20,
        original: otherTenant,
      });
      const imported = await txn({ source: "migration", type: "OPENING_BALANCE", points: 50 });
      const pending = await txn({ type: "REFERRAL_REWARD", status: "PENDING" });
      const expired = await txn({ status: "EXPIRED", meta: { reward_id: foreignReward } });
      await db.query(
        `INSERT INTO redemptions(id,business_id,customer_id,reward_id,code,points_cost,status)
      VALUES($1,$2,$3,$4,'OUR_CODE',10,'CANCELLED'),($5,$2,$6,$4,'PRIVATE_OTHER_CUSTOMER',10,'REDEEMED'),
      ($7,$8,$9,$10,'PRIVATE_OTHER_TENANT',10,'REDEEMED'),($11,$2,$3,$10,'PRIVATE_BAD_REWARD_LINK',10,'REDEEMED')`,
        [
          randomUUID(),
          business,
          customer,
          reward,
          randomUUID(),
          colleague,
          randomUUID(),
          otherBusiness,
          foreignCustomer,
          foreignReward,
          randomUUID(),
        ],
      );
      await db.query("BEGIN READ ONLY");
      const [transactions, redemptions] = await runWithDbContext(
        { client: db, tenantId: business },
        async () => [
          await TxnRepo.listCustomerHistory(business, customer),
          await RedemptionRepo.listCustomerHistory(business, customer),
        ],
      );
      assert.equal(transactions.length, 7);
      assert.ok(
        transactions.every((row) => row.business_id === business && row.customer_id === customer),
      );
      assert.deepEqual(
        redemptions.map((row) => row.code),
        ["OUR_CODE"],
      );
      const rows = new Map(transactions.map((row) => [row.id, row]));
      assert.equal(rows.get(linked).provenance.kind, "reversal");
      assert.equal(rows.get(badCustomerLink).provenance.kind, "unknown");
      assert.equal(rows.get(badTenantLink).provenance.kind, "unknown");
      assert.equal(rows.get(imported).provenance.kind, "opening_balance");
      assert.equal(rows.get(pending).provenance.status, "PENDING");
      assert.equal(rows.get(expired).provenance.status, "EXPIRED");
      assert.equal(rows.get(expired).reward_name, null);
      assert.doesNotMatch(
        JSON.stringify({ transactions, redemptions }),
        /PRIVATE|staff_user_id|original_transaction_id|meta|staff_cost/,
      );
      const native = await runWithDbContext({ client: db }, () => TxnRepo.listByCustomer(customer));
      assert.ok(
        native.every((row) => Object.hasOwn(row, "meta") && !Object.hasOwn(row, "provenance")),
      );
      await db.query("ROLLBACK");
    } finally {
      await db.end();
    }
  },
);
