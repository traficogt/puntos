import {readinessForBusiness} from './merchant-data-readiness.js';
import { randomUUID } from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";
import { reportingPurchase } from './reporting-purchase.js';

// Audience eligibility is also used to persist recovery/marketing selection.
// Keep that contract separate from the read-only reporting definition below.
const PURCHASE_FILTER = `t.source IN ('online','offline','external','order')
  AND (t.type='PURCHASE' OR t.type IS NULL)
  AND t.status IN ('POSTED','PENDING')
  AND (t.amount_q > 0 OR t.visits > 0 OR t.items > 0)
  AND t.original_transaction_id IS NULL
  AND t.reversed_transaction_id IS NULL`;

const AUDIENCE_CTE = `eligible AS (
  SELECT c.id,c.name,MAX(t.created_at) AS last_purchase_at,
    SUM(t.amount_q) AS recorded_sales_q,COUNT(*) AS purchases
  FROM customers c JOIN transactions t ON t.customer_id=c.id AND t.business_id=$1::uuid
  WHERE c.business_id=$1::uuid AND c.deleted_at IS NULL
    AND t.created_at <= $3::timestamptz AND ${PURCHASE_FILTER}
  GROUP BY c.id,c.name
  HAVING MAX(t.created_at) <= $3::timestamptz - $2::int * interval '24 hours'
)`;

/**
 * All periods are elapsed hours, independent of calendar time zones.
 * @param {{businessId:string,inactiveDays?:number,limit?:number,offset?:number,now?:Date}} options
 */
export async function getRecoveryAudience({ businessId, inactiveDays = 30, limit = 10, offset = 0, now = new Date() }, { query = dbQuery } = {}) {
  const business=(await query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1",[businessId])).rows[0];
  if(!business)throw notFound('Negocio no encontrado.');
  const data_readiness=readinessForBusiness(business,now);
  if(!data_readiness.inactivity_allowed)return{total:0,customers:[],paused:true,count_status:'unavailable',data_readiness};
  const { rows } = await query(`WITH ${AUDIENCE_CTE}, page AS (
    SELECT * FROM eligible ORDER BY recorded_sales_q DESC,id LIMIT $4 OFFSET $5
  ) SELECT (SELECT COUNT(*)::int FROM eligible) AS total,
    COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY recorded_sales_q DESC,id) FROM page),'[]'::jsonb) AS customers`,
  [businessId, inactiveDays, now.toISOString(), limit, offset]);
  return { paused:false,count_status:'available',data_readiness,total: rows[0].total, customers: rows[0].customers.map(customer => ({
    ...customer, last_purchase_at: new Date(customer.last_purchase_at).toISOString()
  })) };
}

const RUN_FIELDS = "id,name,notes,inactive_days,requested_limit,member_count,created_at";

function publicRun(row) {
  return {
    id: row.id, name: row.name, notes: row.notes,
    inactive_days: row.inactive_days, requested_limit: row.requested_limit,
    member_count: row.member_count, created_at: new Date(row.created_at).toISOString(),
    contacted_count: row.contacted_count ?? 0,
    returned_count: row.returned_count ?? 0,
    recorded_sales_after_contact_q: Number(row.recorded_sales_after_contact_q ?? 0)
  };
}

/**
 * The unique request key is claimed before reading the audience. A concurrent
 * duplicate waits for commit, then reads the original run in a fresh statement.
 * A failed/empty snapshot rolls back both the claim and its members.
 * @param {{businessId:string,staffId:string,requestId:string,name:string,notes?:string,inactiveDays:number,limit?:number,now?:Date,ip?:string,ua?:string}} options
 */
export async function createRecoveryRun({ businessId, staffId, requestId, name, notes = "", inactiveDays, limit = 50, now = new Date(), ip = null, ua = null }, { transaction = withTransaction, audit = AuditRepo.log } = {}) {
  const normalizedName = name.trim();
  return transaction(async client => {
    const inserted = await client.query(`INSERT INTO recovery_runs
      (id,business_id,request_id,name,notes,inactive_days,requested_limit,created_by_staff_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (business_id,request_id) DO NOTHING RETURNING ${RUN_FIELDS}`,
    [randomUUID(), businessId, requestId, normalizedName, notes, inactiveDays, limit, staffId, now.toISOString()]);
    if (!inserted.rows.length) {
      const existing = await client.query(`SELECT ${RUN_FIELDS} FROM recovery_runs WHERE business_id=$1::uuid AND request_id=$2::uuid`, [businessId, requestId]);
      const row = existing.rows[0];
      if (!row || row.name !== normalizedName || row.notes !== notes || row.inactive_days !== inactiveDays || row.requested_limit !== limit) {
        throw conflict("Esta solicitud ya se usó con otros datos. Crea una nueva solicitud.");
      }
      return { run: publicRun(row) };
    }
    const business=(await client.query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1 FOR SHARE",[businessId])).rows[0];
    if(!readinessForBusiness(business??{},now).inactivity_allowed)throw conflict('Completa la sincronización de compras antes de preparar una lista de recuperación.');
    const run = inserted.rows[0];
    const snapshot = await client.query(`WITH ${AUDIENCE_CTE}
      INSERT INTO recovery_members (business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases)
      SELECT $1::uuid,$4::uuid,id,last_purchase_at,recorded_sales_q,purchases
      FROM eligible ORDER BY recorded_sales_q DESC,id LIMIT $5 RETURNING customer_id`,
    [businessId, inactiveDays, now.toISOString(), run.id, limit]);
    if (!snapshot.rowCount) throw badRequest("No hay clientes elegibles para guardar esta lista.");
    await client.query("UPDATE recovery_runs SET member_count=$3 WHERE business_id=$1::uuid AND id=$2::uuid", [businessId, run.id, snapshot.rowCount]);
    await audit({
      id: randomUUID(), business_id: businessId, actor_type: "STAFF", actor_id: staffId,
      action: "recovery.run.created", ip, ua,
      meta: { run_id: run.id, inactive_days: inactiveDays, member_count: snapshot.rowCount }
    });
    return { run: publicRun({ ...run, member_count: snapshot.rowCount }) };
  });
}

// Results are observed sales after manual contact, never causal attribution.
// Deleted customers disappear from PII and all live result/count calculations.
const RESULTS_CTE = `member_results AS (
  SELECT m.run_id,m.customer_id,c.name,c.phone,m.last_purchase_at,m.recorded_sales_q,
    m.status,m.contacted_at,outcome.returned_at,outcome.recorded_sales_after_contact_q
  FROM recovery_members m
  JOIN selected_runs r ON r.id=m.run_id
  JOIN customers c ON c.id=m.customer_id AND c.business_id=$1::uuid AND c.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT MIN(t.created_at) AS returned_at,COALESCE(SUM(t.amount_q),0) AS recorded_sales_after_contact_q
    FROM transactions t
    WHERE t.business_id=$1::uuid AND t.customer_id=m.customer_id AND m.status='contacted'
      AND t.created_at > m.contacted_at
      AND t.created_at <= m.contacted_at + interval '720 hours'
      AND t.created_at <= $2::timestamptz AND ${reportingPurchase('t')}
  ) outcome ON true
  WHERE m.business_id=$1::uuid
), run_results AS (
  SELECT r.*,stats.contacted_count,stats.returned_count,stats.recorded_sales_after_contact_q
  FROM selected_runs r CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE status='contacted')::int AS contacted_count,
      COUNT(*) FILTER (WHERE returned_at IS NOT NULL)::int AS returned_count,
      COALESCE(SUM(recorded_sales_after_contact_q),0) AS recorded_sales_after_contact_q
    FROM member_results WHERE run_id=r.id
  ) stats
)`;

/** @param {{businessId:string,now?:Date}} options */
export async function listRecoveryRuns({ businessId, now = new Date() }, { query = dbQuery } = {}) {
  const { rows } = await query(`WITH selected_runs AS (
    SELECT ${RUN_FIELDS} FROM recovery_runs WHERE business_id=$1::uuid
    ORDER BY created_at DESC,id DESC LIMIT 20
  ), ${RESULTS_CTE} SELECT * FROM run_results ORDER BY created_at DESC,id DESC`, [businessId, now.toISOString()]);
  return { runs: rows.map(publicRun) };
}

/** @param {{businessId:string,runId:string,limit?:number,offset?:number,now?:Date}} options */
export async function getRecoveryRun({ businessId, runId, limit = 25, offset = 0, now = new Date() }, { query = dbQuery } = {}) {
  const { rows } = await query(`WITH selected_runs AS (
    SELECT ${RUN_FIELDS} FROM recovery_runs WHERE business_id=$1::uuid AND id=$3::uuid
  ), ${RESULTS_CTE}, page AS (
    SELECT * FROM member_results ORDER BY recorded_sales_q DESC,customer_id LIMIT $4 OFFSET $5
  ) SELECT to_jsonb(r) AS run,(SELECT COUNT(*)::int FROM member_results) AS total,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'customer_id',customer_id,'name',name,'phone',phone,'last_purchase_at',last_purchase_at,
      'recorded_sales_q',recorded_sales_q,
      'status',status,'contacted_at',contacted_at,'returned_at',returned_at,
      'recorded_sales_after_contact_q',recorded_sales_after_contact_q
    ) ORDER BY recorded_sales_q DESC,customer_id) FROM page),'[]'::jsonb) AS members
    FROM run_results r`, [businessId, now.toISOString(), runId, limit, offset]);
  if (!rows.length) throw notFound("No se encontró esta lista.");
  const row = rows[0];
  return { run: publicRun(row.run), total: row.total, members: row.members.map(member => ({
    ...member,
    last_purchase_at: new Date(member.last_purchase_at).toISOString(),
    contacted_at: member.contacted_at ? new Date(member.contacted_at).toISOString() : null,
    returned_at: member.returned_at ? new Date(member.returned_at).toISOString() : null
  })) };
}

function publicMember(row) {
  return { customer_id: row.customer_id, status: row.status,
    contacted_at: row.contacted_at ? new Date(row.contacted_at).toISOString() : null };
}

/**
 * Lock both the member and active customer so a concurrent deletion cannot be
 * followed by a new contact event. Terminal states are immutable and retryable.
 * @param {{businessId:string,staffId:string,runId:string,customerId:string,status:string,contactConfirmed?:boolean,ip?:string,ua?:string}} options
 */
export async function updateRecoveryMember({ businessId, staffId, runId, customerId, status, contactConfirmed = false, ip = null, ua = null }, { transaction = withTransaction, audit = AuditRepo.log } = {}) {
  if (!["contacted", "skipped"].includes(status)) throw badRequest("Selecciona contactado u omitido.");
  if (status === "contacted" && contactConfirmed !== true) throw badRequest("Confirma que contactaste a este cliente.");
  return transaction(async client => {
    const { rows } = await client.query(`SELECT m.customer_id,m.status,m.contacted_at
      FROM recovery_members m
      JOIN customers c ON c.id=m.customer_id AND c.business_id=$1::uuid AND c.deleted_at IS NULL
      JOIN recovery_runs r ON r.id=m.run_id AND r.business_id=$1::uuid
      WHERE m.business_id=$1::uuid AND m.run_id=$2::uuid AND m.customer_id=$3::uuid
      FOR UPDATE OF m,c`, [businessId, runId, customerId]);
    const member = rows[0];
    if (!member) throw notFound("No se encontró este cliente en la lista.");
    if (member.status === status) return { member: publicMember(member) };
    if (member.status !== "pending") throw conflict("Este cliente ya tiene un estado final en esta lista.");
    const updated = await client.query(`UPDATE recovery_members
      SET status=$4,contacted_at=CASE WHEN $4='contacted' THEN clock_timestamp() ELSE NULL END,updated_by_staff_id=$5::uuid
      WHERE business_id=$1::uuid AND run_id=$2::uuid AND customer_id=$3::uuid
      RETURNING customer_id,status,contacted_at`, [businessId, runId, customerId, status, staffId]);
    await audit({
      id: randomUUID(), business_id: businessId, actor_type: "STAFF", actor_id: staffId,
      action: "recovery.member.updated", ip, ua,
      meta: { run_id: runId, customer_id: customerId, status, contact_confirmed: status === "contacted" }
    });
    return { member: publicMember(updated.rows[0]) };
  });
}
