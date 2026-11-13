import { businessRegion } from './regional-settings.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dbQuery, withTransaction } from '../database.js';
import { badRequest, conflict, forbidden } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';
import { normalizeCustomerMigration, summarizeCustomerMigration } from './customer-migration-csv.js';

const defaults = { query: dbQuery, transaction: withTransaction };
const uuid = z.guid();
const mapping = z.object({ phone: z.string(), name: z.string().optional(), points: z.string().optional() }).strict();
const sourceSchema=z.object({type:z.enum(['csv_balance','paper_card','progress']),label:z.string().trim().min(3).max(100),evidence:z.string().trim().min(3).max(500),evidence_type:z.enum(['verified_register','owner_attestation']).optional(),conversion:z.object({points_per_unit:z.number().int().min(1).max(100000),approved:z.literal(true)}).strict().optional()}).strict().refine(v=>v.type==='csv_balance'||!!v.conversion,{message:'Aprueba la conversión de progreso.'});
export const migrationPreviewSchema = z.object({
  csv: z.string().min(1).max(204800), columns: mapping.optional(), existing_policy: z.enum(['skip','reject']).default('skip'),source:sourceSchema.optional()
}).strict();
export const migrationCommitSchema = migrationPreviewSchema.extend({
  columns: mapping, request_id: uuid, label: z.string().trim().min(1).max(100), confirmed: z.literal(true)
}).strict();

function requireIdentity(businessId, staffId = undefined) {
  if (!uuid.safeParse(businessId).success || (staffId !== undefined && !uuid.safeParse(staffId).success)) throw badRequest('Contexto de negocio inválido.');
}
function publicBatch(row) {
  return {
    id: row.id, request_id: row.request_id, label: row.label, existing_policy: row.existing_policy,
    row_count: Number(row.row_count), imported_count: Number(row.imported_count), skipped_count: Number(row.skipped_count),
    opening_points: Number(row.opening_points), created_at: new Date(row.created_at).toISOString(),source_evidence:row.source_evidence??null
  };
}
async function existingPhones(query, businessId, phones) {
  // Deleted cards also reserve their tenant-scoped identity. Import never revives one.
  const { rows } = await query('SELECT phone FROM customers WHERE business_id=$1 AND phone=ANY($2::text[])', [businessId, phones]);
  return rows.map(row => row.phone);
}

export async function previewCustomerMigration({ businessId, csv, columns, existingPolicy = 'skip', source = undefined }, injected = {}) {
  requireIdentity(businessId);
  const d = { ...defaults, ...injected };
  const parsed = migrationPreviewSchema.safeParse({ csv, columns, existing_policy: existingPolicy,source });
  if (!parsed.success) throw badRequest('Revisa el archivo y las columnas seleccionadas.');
  const business=(await d.query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1",[businessId])).rows[0];
  const normalized = normalizeCustomerMigration({ csv, columns, country:businessRegion(business).country,source });
  const phones = normalized.rows.filter(row => !row.issues.length).map(row => row.phone);
  return summarizeCustomerMigration(normalized, phones.length ? await existingPhones(d.query, businessId, phones) : [], existingPolicy);
}

export async function listCustomerMigrations({ businessId }, injected = {}) {
  requireIdentity(businessId);
  const d = { ...defaults, ...injected };
  const { rows } = await d.query('SELECT * FROM customer_migration_batches WHERE business_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20', [businessId]);
  return { batches: rows.map(publicBatch) };
}

export async function commitCustomerMigration({ businessId, staffId, requestId, label, csv, columns, existingPolicy = 'skip', confirmed, source = undefined, ip = null, ua = null, impersonated_by = null }, injected = {}) {
  requireIdentity(businessId, staffId);
  const parsed = migrationCommitSchema.safeParse({ request_id: requestId, label, csv, columns, existing_policy: existingPolicy, confirmed,source });
  if (!parsed.success || !staffId) throw badRequest('Revisa el archivo y confirma expresamente la importación del saldo inicial.');
  const data = parsed.data;
  const payloadHash = createHash('sha256').update(JSON.stringify({
    csv: data.csv, columns: { phone: data.columns.phone, name: data.columns.name || '', points: data.columns.points || '' },
    existingPolicy, label: data.label,...(source?{source}:{} )
  })).digest('hex');
  const d = { ...defaults, ...injected };
  return d.transaction(async client => {
    if(source){const owner=(await client.query("SELECT id FROM staff_users WHERE business_id=$1 AND id=$2 AND active AND role='OWNER' FOR SHARE",[businessId,staffId])).rows[0];if(!owner)throw forbidden('El dueño debe aprobar la conversión y su evidencia.');}
    // Serialize this tenant's bounded imports across processes and durable request keys.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [businessId, 'customer-migration']);
    const prior = (await client.query('SELECT * FROM customer_migration_batches WHERE business_id=$1 AND request_id=$2', [businessId, data.request_id])).rows[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw conflict('Este lote ya se guardó con otros datos. Inicia un lote nuevo.');
      return { batch: publicBatch(prior) };
    }
    // A saved request is historical evidence; today's region only validates new batches.
    const business=(await client.query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1",[businessId])).rows[0];
    const normalized = normalizeCustomerMigration({ csv: data.csv, columns: data.columns, country:businessRegion(business).country,source });
    if (normalized.rows.some(row => row.issues.length)) throw badRequest('Corrige todas las filas con errores antes de importar. No se guardó ningún cliente.');
    const batchId = randomUUID();
    let imported = 0, skipped = 0, openingPoints = 0;
    // The same phone lock used by verified enrollment also orders concurrent signup.
    // Stable ordering prevents imports with overlapping phone sets from deadlocking.
    for (const row of [...normalized.rows].sort((a, b) => a.phone.localeCompare(b.phone))) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [businessId, row.phone]);
      const customerId = randomUUID();
      const created = await client.query(`INSERT INTO customers(id,business_id,phone,name,imported_at)
        VALUES($1,$2,$3,$4,now()) ON CONFLICT(business_id,phone) DO NOTHING RETURNING id`, [customerId, businessId, row.phone, row.name]);
      if (!created.rowCount) {
        if (existingPolicy === 'reject') throw conflict('Hay un teléfono que ya pertenece a este negocio. No se guardó ningún cambio del lote.');
        skipped += 1;
        continue;
      }
      await client.query(`INSERT INTO customer_balances(customer_id,points,pending_points,lifetime_points)
        VALUES($1,$2,0,$2)`, [customerId, row.points]);
      await client.query(`INSERT INTO transactions(id,business_id,customer_id,staff_user_id,type,source,status,points,amount_q,visits,items,meta)
        VALUES($1,$2,$3,$4,'OPENING_BALANCE','migration','POSTED',$5,0,0,0,$6::jsonb)`,
      [randomUUID(), businessId, customerId, staffId, row.points, JSON.stringify(withImpersonationMeta({ migration_batch_id: batchId, csv_row: row.row,...(source?{source_evidence:{...source,approved_by_staff_id:staffId},source_units:row.source_units??row.points}:{} ) }, { impersonated_by }))]);
      imported += 1;
      openingPoints += row.points;
    }
    const { rows } = await client.query(`INSERT INTO customer_migration_batches
      (id,business_id,request_id,payload_hash,label,existing_policy,row_count,imported_count,skipped_count,opening_points,created_by_staff_id,source_evidence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [batchId, businessId, data.request_id, payloadHash, data.label, existingPolicy, normalized.rows.length, imported, skipped, openingPoints, staffId,source?{...source,approved_by_staff_id:staffId}:null]);
    // Audit is part of this transaction. It carries totals and references, never the CSV or its contacts.
    await client.query(`INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta)
      VALUES($1,$2,'STAFF',$3,'CUSTOMER_MIGRATION_COMMITTED',$4,$5,$6::jsonb)`,
    [randomUUID(), businessId, staffId, ip, ua, JSON.stringify(withImpersonationMeta({ batch_id: batchId, request_id: data.request_id, row_count: normalized.rows.length, imported_count: imported, skipped_count: skipped, opening_points: openingPoints, existing_policy: existingPolicy }, { impersonated_by }))]);
    return { batch: publicBatch(rows[0]) };
  });
}
