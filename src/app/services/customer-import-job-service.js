import { withImpersonationMeta } from "../../utils/impersonation.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { dbQuery, withTransaction, withDbClientContext } from "../database.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";
import {
  normalizeCustomerMigration,
  summarizeCustomerMigration,
} from "./customer-migration-csv.js";
import {
  commitCustomerMigration,
  migrationPreviewSchema,
  migrationCommitSchema,
} from "./customer-migration-service.js";
import { businessRegion } from "./regional-settings.js";
import { errorStatus } from "../../utils/error-shape.js";
import { IMPORT_CHUNK_ROWS, IMPORT_FILE_ROWS, importChunk } from "./scale-limits.js";
export const largeImportLimits = { rows: IMPORT_FILE_ROWS, bytes: 750 * 1024 };
export const importJobPreviewSchema = migrationPreviewSchema.extend({
  csv: z
    .string()
    .min(1)
    .max(750 * 1024),
  source: z.never().optional(),
});
export const importJobCreateSchema = migrationCommitSchema.extend({
  csv: z
    .string()
    .min(1)
    .max(750 * 1024),
  source: z.never().optional(),
});
const defaults = { query: dbQuery, transaction: withTransaction, context: withDbClientContext };
/** @typedef {typeof defaults} ImportJobDeps */
/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/** @typedef {{ phone: string, name: string | null, points: number }} ImportJobRow */
/**
 * customer_import_jobs row.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   request_id: string,
 *   payload_hash: string,
 *   label: string,
 *   existing_policy: string,
 *   created_by_staff_id: string,
 *   rows_json: ImportJobRow[],
 *   total: number,
 *   processed: number,
 *   imported: number,
 *   skipped: number,
 *   opening_points: number,
 *   status: string,
 *   last_error: string | null,
 *   batch_ids: string[],
 *   expires_at: string | Date,
 *   created_at: string | Date,
 *   updated_at: string | Date,
 * }} ImportJobRecord
 */
/** @param {ImportJobRecord} job */
const publicJob = ({
  rows_json: _rows,
  payload_hash: _hash,
  created_by_staff_id: _staff,
  business_id: _tenant,
  ...job
}) => job;
/**
 * @param {string} businessId
 * @param {unknown} input
 * @param {ImportJobDeps} d
 */
async function inspect(businessId, input, d) {
  const parsed = importJobPreviewSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Revisa el archivo de hasta 5,000 clientes y 750 KB.");
  const business = (await d.query("SELECT program_json FROM businesses WHERE id=$1", [businessId]))
    .rows[0];
  if (!business) throw notFound("Negocio no encontrado.");
  const normalized = normalizeCustomerMigration({
    ...parsed.data,
    limits: largeImportLimits,
    country: businessRegion(business).country,
  });
  const phones = normalized.rows.filter((x) => !x.issues.length).map((x) => x.phone);
  const existing = phones.length
    ? (
        await d.query(
          "SELECT phone FROM customers WHERE business_id=$1 AND phone=ANY($2::text[])",
          [businessId, phones],
        )
      ).rows.map((/** @type {{ phone: string }} */ x) => x.phone)
    : [];
  return summarizeCustomerMigration(normalized, existing, parsed.data.existing_policy);
}
/**
 * @param {{ businessId: string, input: unknown }} request
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function previewCustomerImportJob({ businessId, input }, injected = {}) {
  return inspect(businessId, input, { ...defaults, ...injected });
}
/**
 * @param {{ businessId: string }} request
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function listCustomerImportJobs({ businessId }, injected = {}) {
  const d = { ...defaults, ...injected };
  return {
    jobs: (
      await d.query(
        "SELECT * FROM customer_import_jobs WHERE business_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20",
        [businessId],
      )
    ).rows.map(publicJob),
  };
}
/**
 * @param {TxClient} client
 * @param {string} businessId
 * @param {string} importJobId
 */
async function enqueue(client, businessId, importJobId) {
  await client.query(
    "INSERT INTO background_jobs(id,business_id,job_type,payload,status,run_after) VALUES($1,$2,'customer.import',$3,'QUEUED',now())",
    [randomUUID(), businessId, JSON.stringify({ businessId, importJobId })],
  );
}
/**
 * @param {{ businessId: string, staffId: string, input: unknown, impersonated_by?: string | null }} request
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function createCustomerImportJob(
  { businessId, staffId, input, impersonated_by = null },
  injected = {},
) {
  const parsed = importJobCreateSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Revisa y confirma el lote.");
  const d = { ...defaults, ...injected },
    value = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return d.transaction(async (/** @type {TxClient} */ client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      businessId,
      "customer-import-job",
    ]);
    const prior = (
      await client.query(
        "SELECT * FROM customer_import_jobs WHERE business_id=$1 AND request_id=$2",
        [businessId, value.request_id],
      )
    ).rows[0];
    if (prior) {
      if (prior.payload_hash !== hash)
        throw conflict("Este identificador ya corresponde a otro archivo.");
      return { job: publicJob(prior) };
    }
    const preview = await inspect(
      businessId,
      { csv: value.csv, columns: value.columns, existing_policy: value.existing_policy },
      { ...d, query: client.query.bind(client) },
    );
    if (!preview.can_commit)
      throw badRequest("Corrige todas las filas antes de encolar. No se importó ningún cliente.");
    const job = (
      await client.query(
        `INSERT INTO customer_import_jobs(id,business_id,request_id,payload_hash,label,existing_policy,created_by_staff_id,rows_json,total)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          randomUUID(),
          businessId,
          value.request_id,
          hash,
          value.label,
          value.existing_policy,
          staffId,
          JSON.stringify(preview.rows.map(({ phone, name, points }) => ({ phone, name, points }))),
          preview.rows.length,
        ],
      )
    ).rows[0];
    await enqueue(client, businessId, job.id);
    await client.query(
      "INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,'customer.import.queued',$4)",
      [
        randomUUID(),
        businessId,
        staffId,
        JSON.stringify(
          withImpersonationMeta({ job_id: job.id, total: job.total }, { impersonated_by }),
        ),
      ],
    );
    return { job: publicJob(job) };
  });
}
/**
 * @param {{ businessId: string, staffId: string, id: string, action: string, impersonated_by?: string | null }} request
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function controlCustomerImportJob(
  { businessId, staffId, id, action, impersonated_by = null },
  injected = {},
) {
  if (!z.guid().safeParse(id).success || !["cancel", "retry"].includes(action))
    throw badRequest("Acción de importación inválida.");
  const d = { ...defaults, ...injected };
  return d.transaction(async (/** @type {TxClient} */ client) => {
    const job = (
      await client.query(
        "SELECT * FROM customer_import_jobs WHERE business_id=$1 AND id=$2 FOR UPDATE",
        [businessId, id],
      )
    ).rows[0];
    if (!job) throw notFound("Importación no encontrada.");
    if (action === "cancel") {
      if (!["completed", "cancelled"].includes(job.status))
        await client.query(
          "UPDATE customer_import_jobs SET status='cancelled',rows_json='[]',updated_at=now() WHERE id=$1",
          [id],
        );
    } else {
      if (
        job.status !== "failed" ||
        new Date(job.expires_at) <= new Date() ||
        !job.rows_json.length
      )
        throw conflict(
          "Solo se puede reintentar un lote fallido con archivo vigente dentro de siete días.",
        );
      await client.query(
        "UPDATE customer_import_jobs SET status='queued',last_error=NULL,updated_at=now() WHERE id=$1",
        [id],
      );
      await enqueue(client, businessId, id);
    }
    await client.query(
      "INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,$4,$5)",
      [
        randomUUID(),
        businessId,
        staffId,
        `customer.import.${action}`,
        JSON.stringify(
          withImpersonationMeta({ job_id: id, processed: job.processed }, { impersonated_by }),
        ),
      ],
    );
    return {
      job: publicJob(
        (await client.query("SELECT * FROM customer_import_jobs WHERE id=$1", [id])).rows[0],
      ),
    };
  });
}
/** @param {unknown} value */
const escape = (value) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
/**
 * @param {{ businessId: string, importJobId: string }} payload
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function processCustomerImportChunk({ businessId, importJobId }, injected = {}) {
  const d = { ...defaults, ...injected };
  return d.transaction(async (/** @type {TxClient} */ client) => {
    const job = (
      await client.query(
        "SELECT * FROM customer_import_jobs WHERE business_id=$1 AND id=$2 FOR UPDATE",
        [businessId, importJobId],
      )
    ).rows[0];
    if (!job) throw notFound("Importación no encontrada.");
    if (["completed", "cancelled", "failed"].includes(job.status))
      return { job: publicJob(job), terminal: true };
    const staff = (
      await client.query(
        "SELECT id FROM staff_users WHERE business_id=$1 AND id=$2 AND active AND role='OWNER' FOR SHARE",
        [businessId, job.created_by_staff_id],
      )
    ).rows[0];
    if (!staff || new Date(job.expires_at) <= new Date()) {
      const stopped = (
        await client.query(
          "UPDATE customer_import_jobs SET status='failed',rows_json='[]',last_error=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [
            job.id,
            !staff
              ? "La autorización del propietario ya no está vigente."
              : "El archivo venció después de siete días.",
          ],
        )
      ).rows[0];
      return { job: publicJob(stopped), terminal: true };
    }
    // The cursor is job.processed: a restarted job recomputes the same chunk, and the
    // chunk commit advances the cursor in the same transaction (below).
    const window = importChunk(job.processed, job.total, IMPORT_CHUNK_ROWS);
    const chunk = job.rows_json.slice(window.start, window.end);
    if (!chunk.length) throw new Error("Import progress does not match stored rows");
    // Chunk commit and cursor advancement share one transaction. A lost reply cannot duplicate points.
    const csv =
      "phone,name,points\n" +
      chunk
        .map((/** @type {ImportJobRow} */ row) =>
          ["+" + row.phone, row.name, row.points].map(escape).join(","),
        )
        .join("\n");
    const { batch } = await commitCustomerMigration(
      {
        businessId,
        staffId: job.created_by_staff_id,
        requestId: randomUUID(),
        label: `${job.label.slice(0, 80)} · ${window.index}`,
        csv,
        columns: { phone: "phone", name: "name", points: "points" },
        existingPolicy: job.existing_policy,
        confirmed: true,
      },
      { transaction: (fn) => fn(client) },
    );
    const processed = job.processed + chunk.length,
      done = processed === job.total;
    const next = (
      await client.query(
        `UPDATE customer_import_jobs SET processed=$2,imported=imported+$3,skipped=skipped+$4,opening_points=opening_points+$5,status=$6,
   rows_json=CASE WHEN $7 THEN '[]'::jsonb ELSE rows_json END,batch_ids=array_append(batch_ids,$8::uuid),last_error=NULL,updated_at=now() WHERE id=$1 RETURNING *`,
        [
          job.id,
          processed,
          batch.imported_count,
          batch.skipped_count,
          batch.opening_points,
          done ? "completed" : "running",
          done,
          batch.id,
        ],
      )
    ).rows[0];
    return { job: publicJob(next), terminal: done };
  });
}
/**
 * @param {{ businessId: string, importJobId: string }} payload
 * @param {Partial<ImportJobDeps>} [injected]
 */
export async function runCustomerImportJob(payload, injected = {}) {
  const d = { ...defaults, ...injected };
  return d.context({ tenantId: payload.businessId, platformAdmin: false }, async () => {
    try {
      let result;
      do {
        result = await processCustomerImportChunk(payload, d);
      } while (!result.terminal);
      return {
        ok: true,
        importJobId: payload.importJobId,
        status: result.job.status,
        processed: result.job.processed,
        total: result.job.total,
      };
    } catch (error) {
      const status = errorStatus(error);
      if (status && status < 500) {
        await d.query(
          "UPDATE customer_import_jobs SET status='failed',last_error=$3,updated_at=now() WHERE business_id=$1 AND id=$2 AND status IN ('queued','running')",
          [
            payload.businessId,
            payload.importJobId,
            "El lote se detuvo por un conflicto. Los clientes ya importados se conservan; revisa el archivo y los teléfonos existentes.",
          ],
        );
        return { ok: false, status: "failed" };
      }
      throw error;
    }
  });
}
