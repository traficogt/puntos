import { createHash, randomUUID } from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { parseAudienceDefinition } from "./customer-audience-definition.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";

// The same genuine-purchase predicate used by recovery and campaign measurement.
const PURCHASE_FILTER = `t.source IN ('online','offline','external','order')
  AND (t.type='PURCHASE' OR t.type IS NULL) AND t.status IN ('POSTED','PENDING')
  AND (t.amount_q>0 OR t.visits>0 OR t.items>0)
  AND t.original_transaction_id IS NULL AND t.reversed_transaction_id IS NULL`;
const columns = Object.freeze({ purchase_count: "m.purchase_count", spend_q: "m.spend_q", last_purchase_days: "m.last_purchase_days", joined_days: "m.joined_days", points_balance: "m.points_balance", has_purchase: "m.has_purchase", marketing_opt_in: "m.marketing_opt_in" });

function audienceQuery(businessId, definition, now, limit) {
  const values = [businessId, now.toISOString(), definition.window_days];
  function group(value) {
    if (!value.rules.length) return "FALSE";
    return value.rules.map(rule => {
      values.push(rule.value);
      const comparison = rule.operator === "gte" ? ">=" : rule.operator === "lte" ? "<=" : "=";
      // parseAudienceDefinition restricts fields to this immutable map. Values
      // are parameters; clients cannot supply SQL, identifiers or joins.
      return `COALESCE(${columns[rule.field]} ${comparison} $${values.length},FALSE)`;
    }).join(value.match === "all" ? " AND " : " OR ");
  }
  const include = group(definition.include), exclude = group(definition.exclude);
  values.push(limit);
  const sql = `WITH purchases AS (
    SELECT t.customer_id,MAX(t.created_at) AS last_purchase_at,
      COUNT(*) FILTER(WHERE t.created_at >= $2::timestamptz-$3::int*interval '24 hours')::int AS purchase_count,
      COALESCE(SUM(t.amount_q) FILTER(WHERE t.created_at >= $2::timestamptz-$3::int*interval '24 hours'),0) AS spend_q
    FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id
    WHERE t.business_id=$1::uuid AND c.deleted_at IS NULL AND t.created_at<=$2::timestamptz AND ${PURCHASE_FILTER}
    GROUP BY t.customer_id
  ), metrics AS (
    SELECT c.id,c.name,COALESCE(p.purchase_count,0) AS purchase_count,COALESCE(p.spend_q,0) AS spend_q,
      (p.last_purchase_at IS NOT NULL) AS has_purchase,
      FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz-p.last_purchase_at))/86400)::int AS last_purchase_days,
      FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz-c.created_at))/86400)::int AS joined_days,
      COALESCE(b.points,0) AS points_balance,COALESCE(mp.marketing_opt_in,false) AS marketing_opt_in,
      (COALESCE(mp.marketing_opt_in,false) AND c.phone ~ '^[+0-9 ().-]+$'
        AND regexp_replace(c.phone,'[^0-9]','','g') ~ '^[0-9]{8,15}$') AS contactable
    FROM customers c LEFT JOIN purchases p ON p.customer_id=c.id
    LEFT JOIN customer_balances b ON b.customer_id=c.id
    LEFT JOIN customer_marketing_preferences mp ON mp.business_id=c.business_id AND mp.customer_id=c.id
    WHERE c.business_id=$1::uuid AND c.deleted_at IS NULL AND c.created_at<=$2::timestamptz
  ), matched AS (SELECT m.* FROM metrics m WHERE (${include}) AND NOT (${exclude})),
  page AS (SELECT * FROM matched ORDER BY id LIMIT $${values.length}::int)
  SELECT (SELECT count(*)::int FROM matched) AS total,
    (SELECT count(*)::int FROM matched WHERE contactable) AS contactable_count,
    (SELECT count(*)::int FROM page WHERE contactable) AS selected_contactable_count,
    COALESCE((SELECT jsonb_agg(to_jsonb(page)-'contactable' ORDER BY id) FROM page),'[]'::jsonb) AS customers`;
  return { sql, values };
}

export async function previewCustomerAudience({ businessId, definition, limit = 10, now = new Date() }, { query = dbQuery } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw badRequest("La muestra debe tener entre 1 y 20 clientes.");
  const parsed = parseAudienceDefinition(definition);
  const request = audienceQuery(businessId, parsed, now, limit);
  const { rows } = await query(request.sql, request.values);
  return { total: rows[0].total, contactable_count: rows[0].contactable_count, customers: rows[0].customers, generated_at: now.toISOString() };
}

export function publicCustomerSegment(row) {
  return { id: row.id, name: row.name, version: row.version, definition: row.definition, archived: row.archived, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() };
}
export async function listCustomerSegments({ businessId }, { query = dbQuery } = {}) {
  const { rows } = await query("SELECT * FROM merchant_audiences WHERE business_id=$1::uuid ORDER BY created_at DESC,id DESC LIMIT 100", [businessId]);
  return { segments: rows.map(publicCustomerSegment), total: rows.length };
}
function segmentInput(name, definition) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) throw badRequest("Escribe un nombre de audiencia de hasta 100 caracteres.");
  return { name: name.trim(), definition: parseAudienceDefinition(definition) };
}
async function lockBusiness(client, businessId, overrides) {
  // Serialize owner changes without blocking FK key-share checks from a
  // customer transaction that may hold a row needed by a campaign snapshot.
  const { rows } = await client.query("SELECT id,plan FROM businesses WHERE id=$1::uuid FOR NO KEY UPDATE", [businessId]);
  if (!rows[0]) throw notFound("No se encontró el negocio.");
  if (!hasPlanFeature(rows[0].plan, "analytics", overrides) || !hasPlanFeature(rows[0].plan, "campaign_rules", overrides)) throw forbidden("Tu plan no incluye audiencias de campañas.");
}
async function auditSegment(audit, action, options, segment) {
  await audit({ id: randomUUID(), business_id: options.businessId, actor_type: "STAFF", actor_id: options.staffId, action, ip: options.ip || null, ua: options.ua || null, meta: withImpersonationMeta({ segment_id: segment.id, version: segment.version, archived: segment.archived }, options) });
}
export async function createCustomerSegment(options, { transaction = withTransaction, audit = AuditRepo.log, getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides() } = {}) {
  const input = segmentInput(options.name, options.definition);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const overrides = await getPlanFeatureOverrides();
  return transaction(async client => {
    await lockBusiness(client, options.businessId, overrides);
    const previous = await client.query("SELECT * FROM merchant_audiences WHERE business_id=$1::uuid AND request_id=$2::uuid", [options.businessId, options.requestId]);
    if (previous.rows[0]) {
      if (previous.rows[0].request_fingerprint !== fingerprint) throw conflict("Esta solicitud ya se usó con otros datos.");
      return { segment: publicCustomerSegment(previous.rows[0]) };
    }
    const count = await client.query("SELECT count(*)::int AS total FROM merchant_audiences WHERE business_id=$1::uuid", [options.businessId]);
    if (count.rows[0].total >= 100) throw conflict("Este negocio ya tiene 100 audiencias guardadas. Reutiliza o edita una existente.");
    const { rows } = await client.query(`INSERT INTO merchant_audiences(id,business_id,request_id,request_fingerprint,name,definition,created_by_staff_id)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`, [randomUUID(), options.businessId, options.requestId, fingerprint, input.name, JSON.stringify(input.definition), options.staffId]);
    await auditSegment(audit, "audiences.segment.created", options, rows[0]);
    return { segment: publicCustomerSegment(rows[0]) };
  });
}
export async function updateCustomerSegment(options, { transaction = withTransaction, audit = AuditRepo.log, getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides() } = {}) {
  const input = segmentInput(options.name, options.definition);
  if (!Number.isInteger(options.version) || options.version < 1 || options.version >= 2147483647 || typeof options.archived !== "boolean") throw badRequest("Revisa la versión y el estado de la audiencia.");
  const overrides = await getPlanFeatureOverrides();
  return transaction(async client => {
    await lockBusiness(client, options.businessId, overrides);
    const selected = await client.query("SELECT * FROM merchant_audiences WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE", [options.businessId, options.segmentId]);
    if (!selected.rows[0]) throw notFound("No se encontró esta audiencia.");
    if (selected.rows[0].version !== options.version) throw conflict("La audiencia cambió en otra sesión. Recárgala antes de guardar.");
    const { rows } = await client.query(`UPDATE merchant_audiences SET name=$3,definition=$4::jsonb,archived=$5,version=version+1,updated_at=clock_timestamp()
      WHERE business_id=$1::uuid AND id=$2::uuid RETURNING *`, [options.businessId, options.segmentId, input.name, JSON.stringify(input.definition), options.archived]);
    await auditSegment(audit, "audiences.segment.updated", options, rows[0]);
    return { segment: publicCustomerSegment(rows[0]) };
  });
}

// Called only within campaign creation's transaction after its idempotency check.
export async function snapshotCustomerAudience({ businessId, segmentId, version, limit, now = new Date() }, client) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest("La selección inmediata permite de 1 a 200 clientes.");
  const selected = await client.query("SELECT * FROM merchant_audiences WHERE business_id=$1::uuid AND id=$2::uuid FOR SHARE", [businessId, segmentId]);
  const segment = selected.rows[0];
  if (!segment) throw notFound("No se encontró esta audiencia.");
  if (segment.archived || segment.version !== version) throw conflict("La audiencia está archivada o cambió. Revisa su versión antes de crear la campaña.");
  const definition = parseAudienceDefinition(segment.definition);
  const request = audienceQuery(businessId, definition, now, limit);
  const result = (await client.query(request.sql, request.values)).rows[0];
  if (!result.customers.length) throw badRequest("No hay clientes activos que coincidan con esta audiencia.");
  const ids = result.customers.map(customer => customer.id);
  const active = await client.query("SELECT id FROM customers WHERE business_id=$1::uuid AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE", [businessId, ids]);
  if (active.rowCount !== ids.length) throw conflict("La audiencia cambió mientras se preparaba la campaña. Vuelve a comprobarla.");
  return { customers: active.rows, snapshot: {
    segment_id: segment.id, segment_version: segment.version, name: segment.name, definition,
    cutoff: now.toISOString(), generated_at: now.toISOString(), total: result.total,
    contactable_count: result.contactable_count, selected_contactable_count: result.selected_contactable_count,
    selected_count: ids.length, limit, overflow_count: Math.max(0, result.total - ids.length), selection_order: "customer_id_asc",
  } };
}

// Worker-only: definition is frozen when the owner queues the job. The first
// worker transaction captures IDs once; every later chunk reuses those IDs.
export async function snapshotFrozenCustomerAudience({ businessId, snapshot, limit, now = new Date() }, client) {
  if (!Number.isInteger(limit) || limit < 10 || limit > 5000) throw badRequest("La preparación permite de 10 a 5,000 clientes.");
  const definition = parseAudienceDefinition(snapshot.definition);
  const request = audienceQuery(businessId, definition, now, limit);
  const result = (await client.query(request.sql, request.values)).rows[0];
  const ids = result.customers.map(customer => customer.id);
  return { customerIds: ids, snapshot: { ...snapshot, cutoff: now.toISOString(), generated_at: now.toISOString(), total: result.total,
    contactable_count: result.contactable_count, selected_contactable_count: result.selected_contactable_count,
    selected_count: ids.length, limit, overflow_count: Math.max(0, result.total - ids.length), selection_order: "customer_id_asc" } };
}
