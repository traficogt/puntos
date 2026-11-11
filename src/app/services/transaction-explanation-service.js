import { dateTimeSchema } from '../../utils/date-time-schema.js';
import { z } from 'zod';
import { dbQuery, getDbTenantId } from '../database.js';
import { badRequest, notFound } from '../../utils/http-error.js';
import { activityAttributionSql, activityGroups } from './activity-attribution.js';
import { targetedOfferCriteriaSchema } from './transaction-rule-evidence.js';

export const movementKinds = ['all', 'purchase', 'redemption', 'refund', 'opening_balance', 'adjustment', 'other'];
const uuid = z.guid();
export const transactionHistoryFilters = z.object({
  staff_id: uuid.transform(value => value.toLowerCase()).optional(),
  source_group: z.string().refine(value => activityGroups.includes(value)).optional(),
  branch_id: uuid.transform(value => value.toLowerCase()).optional(),
  start: dateTimeSchema().optional(), end: dateTimeSchema().optional()
}).strict();
export function validHistoryInterval(value) {
  return (!value.start && !value.end) || (Boolean(value.start && value.end) && Date.parse(value.start) < Date.parse(value.end) && Date.parse(value.end) - Date.parse(value.start) <= 93 * 86400000);
}
const finite = z.number().finite();
const numberOrNull = finite.nullable();
const date = dateTimeSchema();
const rule = z.object({
  index: z.number().int().nonnegative(), present: z.boolean(), active: z.boolean(), program_type: z.enum(['SPEND','VISIT','ITEM','OTHER']).nullable(),
  kind: z.enum(['bonus_points','multiplier']), value: finite, max_points: numberOrNull,
  condition: z.object({ weekdays: z.array(z.number().int().min(0).max(6)).nullable(), min_amount_q: numberOrNull, min_visits: numberOrNull, min_items: numberOrNull, start_hour: numberOrNull, end_hour: numberOrNull }),
  outcome: z.enum(['applied','inactive','program_type','weekday','min_amount_q','min_visits','min_items','hours']), points_before: finite, points_after: finite
});
// Parse every level to an allowlist; neither configuration nor arbitrary meta is returned.
const awardSchema = z.object({
  schema_version: z.literal(1), algorithm: z.literal('pf-points-v1'), rule_version: z.string().regex(/^[a-f0-9]{64}$/),
  evaluated_at: date, clock: z.literal('server'), time_zone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }), local_weekday: z.number().int().min(0).max(6), local_hour: z.number().int().min(0).max(24),
  inputs: z.object({ amount_q: finite, visits: finite, items: finite }),
  program: z.object({ type: z.enum(['SPEND','VISIT','ITEM']), rate: finite, round: z.enum(['ceil','floor','round']), quantity: finite }),
  base_points: finite, rules: z.array(rule).max(1000), program_points: z.number().int().nonnegative(),
  targeted_offer: z.object({ bonus_points: z.number().int().nonnegative(), campaign_id: uuid.nullable(), criteria: z.union([z.literal('not_snapshotted'), targetedOfferCriteriaSchema]) }),
  awarded_points: z.number().int().nonnegative(), hold_days: z.number().int().nonnegative(), initial_status: z.enum(['POSTED','PENDING']), available_at: date.nullable(),
  offline_capture: z.object({ recorded_at: date, clock: z.literal('client_reported') }).nullable()
});
const cursorSchema = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => Number.isFinite(Date.parse(value))), id: uuid, record: z.enum(['transaction','adjustment','redemption']) }).strict();
const kinds = { purchase: 'Compra', redemption: 'Canje', refund: 'Reversión', opening_balance: 'Saldo inicial', adjustment: 'Ajuste de saldo', other: 'Otro movimiento' };
const statuses = ['POSTED','PENDING','REVERSED','EXPIRED','REDEEMED','CANCELLED','CANCELED'];
const sources = ['online','offline','external','order','redeem','reversal','migration','ledger_correction','referral','tier','achievement','challenge','birthday','anniversary','reactivation','gift_card','pos_checkout_cancel'];

// Tenant and customer predicates on every join also protect legacy single-column FKs.
const activity = `WITH activity AS (
 SELECT t.id,'transaction'::text AS record,t.created_at,t.business_id,t.customer_id,t.staff_user_id,t.branch_id,
 CASE WHEN t.source='redeem' THEN 'redemption' WHEN t.source IN('reversal','pos_checkout_cancel') OR t.type='REFUND' THEN 'refund'
   WHEN t.type='OPENING_BALANCE' THEN 'opening_balance' WHEN t.type='PURCHASE' THEN 'purchase' ELSE 'other' END AS kind,
 t.points,t.amount_q,t.visits,t.items,t.status,t.source,t.available_at,t.expired_at,
 t.meta->'award_evidence' AS award_evidence,r.id AS redemption_id,r.points_cost,r.status AS redemption_status,r.reward_id,
 original.id AS original_id,reversal.id AS reversal_id,0::int AS delta_pending,0::int AS delta_lifetime
 FROM transactions t
 LEFT JOIN redemptions r ON t.source='redeem' AND r.business_id=t.business_id AND r.customer_id=t.customer_id AND r.id::text=t.meta->>'redemption_id'
 LEFT JOIN transactions original ON original.id=t.original_transaction_id AND original.business_id=t.business_id AND original.customer_id=t.customer_id
 LEFT JOIN transactions reversal ON reversal.id=t.reversed_transaction_id AND reversal.business_id=t.business_id AND reversal.customer_id=t.customer_id
 WHERE t.business_id=$1::uuid
 UNION ALL
 SELECT a.id,'adjustment',a.created_at,a.business_id,a.customer_id,a.created_by_staff_id,NULL::uuid,'adjustment',a.delta_points,0,0,0,'POSTED','ledger_correction',NULL::timestamptz,NULL::timestamptz,NULL::jsonb,NULL::uuid,NULL::int,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,a.delta_pending_points,a.delta_lifetime_points
 FROM ledger_balance_adjustments a WHERE a.business_id=$1::uuid
 UNION ALL
 SELECT r.id,'redemption',COALESCE(r.redeemed_at,r.created_at),r.business_id,r.customer_id,r.staff_user_id,r.branch_id,'redemption',NULL::int,0,0,0,r.status,'redeem',NULL::timestamptz,NULL::timestamptz,NULL::jsonb,r.id,r.points_cost,r.status,r.reward_id,NULL::uuid,NULL::uuid,0,0
 FROM redemptions r WHERE r.business_id=$1::uuid AND NOT EXISTS (
   SELECT 1 FROM transactions t WHERE t.business_id=r.business_id AND t.customer_id=r.customer_id AND t.source='redeem' AND t.meta->>'redemption_id'=r.id::text)
)
SELECT a.*,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
 c.name AS customer_name,s.name AS staff_name,b.name AS branch_name,rw.name AS reward_name
FROM activity a
JOIN customers c ON c.id=a.customer_id AND c.business_id=a.business_id
LEFT JOIN staff_users s ON s.id=a.staff_user_id AND s.business_id=a.business_id
LEFT JOIN branches b ON b.id=a.branch_id AND b.business_id=a.business_id
LEFT JOIN rewards rw ON rw.id=a.reward_id AND rw.business_id=a.business_id`;

function iso(value) { return value ? new Date(value).toISOString() : null; }
function name(value) { return typeof value === 'string' ? value.slice(0,200) : null; }
function safeAward(row) {
  const parsed = awardSchema.safeParse(row.award_evidence);
  if (!parsed.success || row.kind !== 'purchase') return null;
  const value = parsed.data;
  if (value.inputs.amount_q !== Number(row.amount_q) || Math.max(0, Math.floor(value.inputs.visits)) !== Number(row.visits) || Math.max(0, Math.floor(value.inputs.items)) !== Number(row.items)) return null;
  if (value.awarded_points !== Number(row.points) || value.program_points + value.targeted_offer.bonus_points !== value.awarded_points) return null;
  const criteria = value.targeted_offer.criteria;
  if (typeof criteria === 'object' && (
    criteria.purchase.amount_q !== Number(row.amount_q) || criteria.purchase.visits !== Number(row.visits) || criteria.purchase.items !== Number(row.items) || criteria.purchase.source !== row.source ||
    criteria.minimum_purchase_q > Number(row.amount_q) || criteria.points_committed_after - criteria.points_committed_before !== value.targeted_offer.bonus_points ||
    (criteria.points_budget !== null && criteria.points_committed_after > criteria.points_budget)
  )) return null;
  return value;
}
function coverage(award) { return award && (!award.targeted_offer.bonus_points || typeof award.targeted_offer.criteria === 'object') ? 'recorded' : 'partial'; }
function movement(row) {
  return { id: row.id, record: row.record, kind: row.kind, label: kinds[row.kind], created_at: iso(row.created_at),
    customer_id: row.customer_id, customer_name: name(row.customer_name), staff_name: name(row.staff_name), branch_name: name(row.branch_name),
    points: row.points === null ? null : Number(row.points), amount_q: Number(row.amount_q), visits: Number(row.visits), items: Number(row.items),
    status: statuses.includes(row.status) ? row.status : 'UNKNOWN', source: sources.includes(row.source) ? row.source : 'other',
    available_at: iso(row.available_at), expired_at: iso(row.expired_at),
    redemption: row.redemption_id ? { id: row.redemption_id, points_cost: Number(row.points_cost), reward_name: name(row.reward_name), status: statuses.includes(row.redemption_status) ? row.redemption_status : 'UNKNOWN' } : null,
    adjustment: row.kind === 'adjustment' ? { points: Number(row.points), pending_points: Number(row.delta_pending), lifetime_points: Number(row.delta_lifetime) } : null,
    links: { original_id: row.original_id, reversal_id: row.reversal_id },
    evidence: coverage(safeAward(row))
  };
}
function explanation(row) {
  const award = safeAward(row), limitations = [], steps = [];
  if (row.kind === 'purchase') {
    if (award) {
      steps.push({ label: 'Puntos del programa', points: award.program_points });
      if (award.targeted_offer.bonus_points) {
        steps.push({ label: 'Bono de oferta dirigida', points: award.targeted_offer.bonus_points });
        if (award.targeted_offer.criteria === 'not_snapshotted') limitations.push('Se guardaron el bono y el ID de la oferta dirigida. Sus condiciones y disponibilidad no se guardaron en este movimiento.');
        else limitations.push('La oferta se aplicó por la pertenencia guardada al grupo que recibe el bono. Los criterios originales de selección de la audiencia no se volvieron a evaluar durante esta compra.');
      }
      steps.push({ label: 'Total registrado', points: Number(row.points) });
    } else limitations.push('No se guardaron las reglas evaluadas de esta compra. No se puede reconstruir su cálculo con la configuración actual.');
  } else if (row.kind === 'opening_balance') {
    steps.push({ label: 'Puntos de saldo inicial importado', points: Number(row.points) });
    limitations.push('El saldo inicial no representa una compra ni puntos calculados con las reglas del programa.');
  } else if (row.kind === 'adjustment') {
    steps.push({ label: 'Cambio de puntos disponibles', points: Number(row.points) }, { label: 'Cambio de puntos pendientes', points: Number(row.delta_pending) }, { label: 'Cambio de puntos acumulados', points: Number(row.delta_lifetime) });
    limitations.push('Este ajuste corrige saldos. No representa una compra ni modifica los puntos del movimiento original.');
  } else if (row.kind === 'redemption') {
    if (row.points !== null) steps.push({ label: 'Puntos debitados en el historial', points: Number(row.points) });
    limitations.push(row.record === 'redemption' ? 'Hay un registro de canje, pero no se encontró su débito enlazado en el historial. No se puede confirmar aquí el cambio de saldo.' : 'El costo registrado del canje no depende del precio actual de la recompensa. Las condiciones de elegibilidad de ese momento no se guardaron.');
  } else if (row.kind === 'refund') {
    steps.push({ label: 'Puntos registrados en la reversión', points: Number(row.points) });
    limitations.push('La reversión de puntos no confirma una devolución de dinero. Comprueba el recibo en tu caja.');
  } else limitations.push('Se muestra el movimiento registrado. No hay evidencia suficiente para explicar todas sus reglas de origen.');
  limitations.push('Los nombres son los que figuran actualmente en PF. Este detalle no reconstruye el saldo anterior ni el saldo posterior.');
  return { coverage: coverage(award), award, steps, limitations };
}
function requireTenant(businessId) {
  if (!uuid.safeParse(businessId).success || String(getDbTenantId() || '') !== String(businessId)) throw notFound('Negocio no disponible.');
}
export async function listTransactionHistory({ businessId, limit = 25, cursor = undefined, kind = 'all', ...filters }) {
  requireTenant(businessId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !movementKinds.includes(kind)) throw badRequest('Filtro de movimientos no válido.');
  const parsedFilters = transactionHistoryFilters.refine(validHistoryInterval).safeParse(filters);
  if (!parsedFilters.success) throw badRequest('Filtros de persona, origen o fechas no válidos.');
  const filter = parsedFilters.data;
  let after = null;
  if (cursor) {
    try { if (typeof cursor !== 'string' || cursor.length > 400) throw new Error(); after = cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))); }
    catch { throw badRequest('La página de movimientos no es válida. Vuelve al inicio.'); }
  }
  const { rows } = await dbQuery(`${activity}
    WHERE ($2::text='all' OR a.kind=$2) AND ($3::timestamptz IS NULL OR (a.created_at,a.id,a.record)<($3::timestamptz,$4::uuid,$5::text))
    AND ($7::uuid IS NULL OR (a.staff_user_id=$7 AND (${activityAttributionSql})='staff'))
    AND ($8::text IS NULL OR (${activityAttributionSql})=$8)
    AND ($9::uuid IS NULL OR a.branch_id=$9)
    AND ($10::timestamptz IS NULL OR a.created_at>=$10)
    AND ($11::timestamptz IS NULL OR a.created_at<$11)
    ORDER BY a.created_at DESC,a.id DESC,a.record DESC LIMIT $6`, [businessId,kind,after?.at ?? null,after?.id ?? null,after?.record ?? null,limit+1,filter.staff_id ?? null,filter.source_group ?? null,filter.branch_id ?? null,filter.start ?? null,filter.end ?? null]);
  const page = rows.slice(0,limit), last = page.at(-1);
  return { movements: page.map(movement), next_cursor: rows.length > limit ? Buffer.from(JSON.stringify({ at: last.cursor_at,id: last.id,record: last.record })).toString('base64url') : null, limit };
}
export async function getTransactionExplanation({ businessId, id }) {
  requireTenant(businessId);
  if (!uuid.safeParse(id).success) throw badRequest('El ID del movimiento no es válido.');
  const { rows } = await dbQuery(`${activity} WHERE a.id=$2::uuid OR a.redemption_id=$2::uuid ORDER BY a.created_at DESC,a.id DESC LIMIT 1`, [businessId,id]);
  if (!rows[0]) throw notFound('No se encontró ese movimiento en este negocio.');
  return { movement: movement(rows[0]), explanation: explanation(rows[0]) };
}
