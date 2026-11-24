import { businessRegion } from "./regional-settings.js";
import crypto from "node:crypto";
import { z } from "zod";
import { dbQuery, withDbClientContext } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { awardFromExternalEventTrusted } from "./external-award-service.js";
import { computePoints } from "./points-service.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { isLedgerInteger } from "../../utils/ledger-limits.js";
import { encryptProgramSecrets } from "../../utils/program-secrets.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { normalizePosSale, posEventId, safePosIntegration } from "./pos/common.js";
import { normalizePosCsv } from "./pos/csv.js";
import {
  fetchLoyverseSales,
  fetchLoyverseSalesByReceiptIds,
  verifyLoyverseConnection,
} from "./pos/loyverse.js";
import {
  enqueuePosRefund,
  reconcilePosRefund,
  retryPendingPosRefunds,
  reconcilePendingRefundsForSale,
} from "./pos-refund-service.js";
import { assertPurchaseTimeReplay } from "./purchase-event-time.js";
import { posMeasurementReceipt, recordPosMeasurementReceipts } from "./pos-measurement-receipts.js";
import { errorMessage, errorStatus } from "../../utils/error-shape.js";

const SettingsSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["api", "csv", "loyverse"]),
    automatic: z.boolean().optional(),
    loyverse: z
      .object({
        access_token: z.string().trim().min(1).max(4096).optional(),
        store_id: z.string().trim().max(128).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const PreflightSchema = z
  .object({
    saleId: z.string().min(1).max(200),
    source: z.string().min(1).max(180),
    customerPhone: z.string().min(1).max(40),
    amountQ: z.number().finite().min(0).max(99999999.99),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["paid", "completed"]),
    items: z.number().int().min(0).max(2147483647).optional(),
    occurredAt: z.string().optional(),
  })
  .strict();

/**
 * Business row as BusinessRepo.getById returns it (repositories owner); the fields read here.
 * businesses.program_json is NOT NULL DEFAULT '{}'.
 * @typedef {{
 *   id: string,
 *   slug: string,
 *   plan?: string | null,
 *   program_type?: string | null,
 *   program_json: Record<string, any>
 * }} PosIntegrationBusiness
 *
 * Connected Loyverse account stored under program_json.pos_integration.loyverse.
 * @typedef {{
 *   access_token?: string | null,
 *   merchant_id?: string | null,
 *   merchant_name?: string | null,
 *   store_id?: string | null
 * }} PosIntegrationLoyverseSettings
 *
 * @typedef {{ since: string, until: string, cursor: string | null }} PosIntegrationSyncWindow
 *
 * program_json.pos_integration once the owner has saved a connection (a fresh business has none).
 * @typedef {{
 *   enabled: boolean,
 *   mode: string,
 *   automatic: boolean,
 *   loyverse: PosIntegrationLoyverseSettings,
 *   revision: string,
 *   connected_at: string,
 *   last_completed_at: string | null,
 *   sync_window: PosIntegrationSyncWindow | null,
 *   last_sync: Record<string, unknown> | null,
 *   pending_receipts: string[]
 * }} PosIntegrationConfig
 *
 * @typedef {import("zod").infer<typeof SettingsSchema>} PosIntegrationSettingsInput
 *
 * A sale entering the preview/apply pipeline: the pos/common, pos/csv or pos/loyverse
 * shape, re-validated by normalizePosSale() so optional fields may still be missing.
 * @typedef {{
 *   row?: number | null,
 *   saleId: string,
 *   source?: string,
 *   customerPhone: string,
 *   amountQ: number,
 *   currency?: string,
 *   visits?: number,
 *   items?: number,
 *   occurredAt?: string | null
 * }} PosIntegrationSale
 *
 * A receipt an adapter could not turn into a sale.
 * @typedef {{
 *   row?: number | null,
 *   saleId: string,
 *   source?: string,
 *   occurredAt?: string | null,
 *   code: string,
 *   message: string,
 *   status?: string
 * }} PosIntegrationIssue
 *
 * One line of the owner's preview table.
 * @typedef {{
 *   row: number | null,
 *   saleId: string,
 *   customerPhone: string,
 *   amountQ: number | null,
 *   points: number,
 *   status: string,
 *   code: string,
 *   message: string,
 *   source?: string,
 *   occurredAt?: string | null
 * }} PosIntegrationPreviewRow
 *
 * @typedef {{ total: number, ready: number, errors: number, ignored: number, duplicates: number }} PosIntegrationSummary
 * @typedef {{ ok: boolean, headers: string[], rows: PosIntegrationPreviewRow[], summary: PosIntegrationSummary }} PosIntegrationPreview
 * @typedef {import("./pos-measurement-receipts.js").PosMeasurementReceipt} PosIntegrationReceipt
 *
 * A sale that passed preview and is ready for apply().
 * @typedef {{
 *   row: PosIntegrationPreviewRow,
 *   sale: import("./pos/common.js").PosCommonSale,
 *   meta: { pos_sale: Record<string, unknown> },
 *   receipt: PosIntegrationReceipt | null
 * }} PosIntegrationReadyEntry
 *
 * @typedef {{ row: number | null, saleId: string, code: string, message: string }} PosIntegrationResultIssue
 * @typedef {{
 *   awarded: number,
 *   duplicates: number,
 *   errors: number,
 *   ignored: number,
 *   issues: PosIntegrationResultIssue[]
 * }} PosIntegrationApplyResult
 * Loyverse sync outcome; the refund counters are absent when the automatic poll is
 * skipped because the owner left automatic sync off.
 * @typedef {PosIntegrationApplyResult & {
 *   has_more: boolean,
 *   refunds_received?: number,
 *   refunds_reconciled?: number,
 *   refunds_pending?: number
 * }} PosIntegrationSyncResult
 *
 * ingestPosSale answers either a read-only dry run (the preview table) or the apply
 * result; each member declares the other's keys as undefined so callers can branch.
 * @typedef {PosIntegrationPreview & { dryRun: true, result?: undefined }} PosIntegrationDryRunResponse
 * @typedef {{
 *   ok: boolean,
 *   result: PosIntegrationApplyResult,
 *   dryRun?: undefined,
 *   headers?: undefined,
 *   rows?: undefined,
 *   summary?: undefined
 * }} PosIntegrationApplyResponse
 *
 * A refund as a provider page reports it. enqueueRefund validates the whole body; this
 * module only needs the id and the native evidence.
 * @typedef {{ refundId: string, nativeEvidence?: string | null, [field: string]: unknown }} PosIntegrationPageRefund
 * @typedef {{
 *   sales: PosIntegrationSale[],
 *   issues: PosIntegrationIssue[],
 *   refunds?: PosIntegrationPageRefund[],
 *   nextCursor?: string | null
 * }} PosIntegrationFetchedPage
 * @typedef {{
 *   accessToken: string,
 *   merchantId?: string | null,
 *   storeId?: string | null,
 *   region: import("./regional-settings.js").RegionalSettings
 * }} PosIntegrationFetchArgs
 *
 * The `transactions` row an earlier import of the same sale left (ledger row, repositories owner).
 * @typedef {{
 *   id: string,
 *   customer_id: string,
 *   points: number | string,
 *   meta: Record<string, any> | null,
 *   purchase_occurred_at: Date | string | null,
 *   purchase_time_source: string | null
 * }} PosIntegrationExistingTransaction
 *
 * Collaborators of this service: `defaultDeps` in production, fakes in unit tests. Each
 * member is typed by what this module uses from it.
 * @typedef {{
 *   getBusiness: (id: string) => Promise<PosIntegrationBusiness | null | undefined>,
 *   getCustomer: (businessId: string, phone: string) => Promise<{ id: string, business_id: string } | null | undefined>,
 *   findTransaction: (businessId: string, eventId: string) => Promise<PosIntegrationExistingTransaction | null>,
 *   saveSettings: (businessId: string, patch: Record<string, any>, options?: { initializeExternalKey?: boolean }) => Promise<void>,
 *   saveSync: (businessId: string, revision: string, patch: Record<string, any>) => Promise<void>,
 *   hasFeature: (business: PosIntegrationBusiness) => Promise<boolean>,
 *   lock: <T>(businessId: string, fn: () => Promise<T>) => Promise<T>,
 *   award: (input: import("./external-award-service.js").ExternalAwardInput) => Promise<{ replay?: boolean, transactionId?: string | null }>,
 *   verifyConnection: (args: {
 *     accessToken: string,
 *     storeId: string | null | undefined,
 *     region: import("./regional-settings.js").RegionalSettings
 *   }) => Promise<{ merchantId: string, merchantName: string, storeId: string | null }>,
 *   fetchSales: (args: PosIntegrationFetchArgs & PosIntegrationSyncWindow) => Promise<PosIntegrationFetchedPage>,
 *   fetchRetrySales: (args: PosIntegrationFetchArgs & { receiptIds: string[] }) => Promise<PosIntegrationFetchedPage>,
 *   enqueueRefund: (
 *     businessId: string,
 *     refund: Record<string, unknown>,
 *     options: { origin: string, nativeEvidence: string | null | undefined }
 *   ) => Promise<{ refund: { id: string } }>,
 *   reconcileRefund: (businessId: string, refundId: string, options: { automatic: boolean }) => Promise<{ refund: { status: string } }>,
 *   retryRefunds: (businessId: string) => Promise<unknown[]>,
 *   reconcileSaleRefunds: (businessId: string, sale: { source: string, saleId: string }) => Promise<unknown[]>,
 *   recordReceipts: (businessId: string, receipts: PosIntegrationReceipt[]) => Promise<void>,
 *   now: () => Date
 * }} PosIntegrationDeps
 */

/**
 * @template T
 * @param {string} businessId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withPosLock(businessId, fn) {
  return withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
    const { rows } = await dbQuery(
      "SELECT pg_try_advisory_lock(hashtext('pos-integration'), hashtext($1)) AS locked",
      [businessId],
    );
    if (!rows[0]?.locked)
      throw conflict(
        "Hay una importación o conexión en curso. Espera unos segundos y vuelve a intentar.",
      );
    try {
      return await fn();
    } finally {
      await dbQuery("SELECT pg_advisory_unlock(hashtext('pos-integration'), hashtext($1))", [
        businessId,
      ]);
    }
  });
}

/** @type {PosIntegrationDeps} */
const defaultDeps = {
  getBusiness: (id) => BusinessRepo.getById(id),
  getCustomer: (businessId, phone) => CustomerRepo.getByBusinessAndPhone(businessId, phone),
  findTransaction: async (businessId, eventId) => {
    const { rows } = await dbQuery(
      "SELECT id, customer_id, points, meta, purchase_occurred_at, purchase_time_source FROM transactions WHERE business_id=$1 AND source='external' AND meta->>'external_event_id'=$2 LIMIT 1",
      [businessId, eventId],
    );
    return rows[0] ?? null;
  },
  saveSettings: async (businessId, patch, { initializeExternalKey = false } = {}) => {
    // Merge only submitted external fields under the row lock so a concurrent
    // legacy settings write cannot be replaced by an earlier business snapshot.
    await dbQuery(
      `UPDATE businesses SET program_json =
      COALESCE(program_json, '{}'::jsonb) || ($2::jsonb - 'external_awards') ||
      CASE WHEN $2::jsonb ? 'external_awards' THEN jsonb_build_object('external_awards',
        (CASE WHEN jsonb_typeof(program_json->'external_awards') = 'object' THEN program_json->'external_awards' ELSE '{}'::jsonb END) ||
        (CASE WHEN $3::boolean AND NULLIF(program_json#>>'{external_awards,api_key}', '') IS NOT NULL
          THEN ($2::jsonb->'external_awards') - 'api_key' ELSE $2::jsonb->'external_awards' END))
      ELSE '{}'::jsonb END, updated_at=now() WHERE id=$1`,
      [businessId, encryptProgramSecrets(patch), initializeExternalKey],
    );
  },
  saveSync: async (businessId, revision, patch) => {
    await dbQuery(
      "UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_integration}',(program_json->'pos_integration') || $3::jsonb), updated_at=now() WHERE id=$1 AND program_json#>>'{pos_integration,revision}'=$2",
      [businessId, revision, patch],
    );
  },
  hasFeature: async (business) =>
    hasPlanFeature(
      business.plan,
      "external_awards",
      await PlanConfigService.getPlanFeatureOverrides(),
    ),
  lock: withPosLock,
  award: awardFromExternalEventTrusted,
  verifyConnection: verifyLoyverseConnection,
  fetchSales: fetchLoyverseSales,
  fetchRetrySales: fetchLoyverseSalesByReceiptIds,
  enqueueRefund: enqueuePosRefund,
  reconcileRefund: reconcilePosRefund,
  retryRefunds: retryPendingPosRefunds,
  reconcileSaleRefunds: reconcilePendingRefundsForSale,
  recordReceipts: recordPosMeasurementReceipts,
  now: () => new Date(),
};

/**
 * @param {PosIntegrationPreview} preview
 * @returns {PosIntegrationApplyResult}
 */
function resultFromPreview(preview) {
  return {
    awarded: 0,
    duplicates: preview.summary.duplicates,
    errors: preview.summary.errors,
    ignored: preview.summary.ignored,
    issues: preview.rows
      .filter((row) => row.status !== "ready" && row.status !== "duplicate")
      .map(({ row, saleId, code, message }) => ({ row, saleId, code, message })),
  };
}

// --- shared access -----------------------------------------------------------

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 */
async function loadBusiness(deps, id) {
  const business = await deps.getBusiness(id);
  if (!business) throw notFound("Negocio no encontrado.");
  return business;
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {string} [mode]
 */
async function requireEnabled(deps, business, mode) {
  /** @type {Partial<PosIntegrationConfig> | undefined} */
  const cfg = business.program_json?.pos_integration;
  if (
    !cfg?.enabled ||
    !business.program_json?.external_awards?.enabled ||
    (mode && cfg.mode !== mode)
  )
    throw forbidden("Activa y guarda este tipo de conexión antes de importar ventas.");
  if (!(await deps.hasFeature(business))) throw forbidden("Tu plan no permite conexiones POS.");
}

/** @param {PosIntegrationBusiness} business */
const integrationResponse = (business) => ({
  ok: true,
  business: { slug: business.slug },
  integration: safePosIntegration(business),
});

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 */
async function readPosIntegration(deps, id) {
  return integrationResponse(await loadBusiness(deps, id));
}

// --- settings ----------------------------------------------------------------

// Verifies submitted Loyverse credentials when they changed (or the connection
// is being enabled) and returns the native settings to persist.
/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationSettingsInput} data
 * @param {Partial<PosIntegrationConfig>} current
 * @returns {Promise<PosIntegrationLoyverseSettings>}
 */
async function resolveLoyverseCredentials(deps, business, data, current) {
  /** @type {PosIntegrationLoyverseSettings} */
  let native = { ...(current.loyverse ?? {}) };
  const accessToken = data.loyverse?.access_token ?? native.access_token;
  const storeId =
    data.loyverse?.store_id === undefined ? native.store_id : data.loyverse.store_id || null;
  if (
    data.loyverse?.access_token ||
    storeId !== native.store_id ||
    (data.mode === "loyverse" && data.enabled)
  ) {
    if (!accessToken || String(accessToken).startsWith("enc:"))
      throw badRequest("Agrega un token de lectura de Loyverse para conectar.");
    let verified;
    try {
      verified = await deps.verifyConnection({
        accessToken,
        storeId,
        region: businessRegion(business),
      });
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    native = {
      access_token: accessToken,
      merchant_id: verified.merchantId,
      merchant_name: verified.merchantName,
      store_id: verified.storeId,
    };
  }
  return native;
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationSettingsInput} data
 * @param {Partial<PosIntegrationConfig>} current
 * @param {PosIntegrationLoyverseSettings} native
 */
function nextPosIntegrationSettings(deps, business, data, current, native) {
  const reset =
    data.enabled &&
    (!current.enabled ||
      !business.program_json?.external_awards?.enabled ||
      current.mode !== data.mode ||
      current.loyverse?.merchant_id !== native.merchant_id ||
      current.loyverse?.store_id !== native.store_id);
  const next = {
    ...current,
    enabled: data.enabled,
    mode: data.mode,
    automatic: data.automatic ?? current.automatic ?? false,
    loyverse: native,
    revision: crypto.randomUUID(),
  };
  if (reset || !next.connected_at)
    Object.assign(next, {
      connected_at: deps.now().toISOString(),
      last_completed_at: null,
      sync_window: null,
      last_sync: null,
      pending_receipts: [],
    });
  return next;
}

/**
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationSettingsInput} data
 */
function externalAwardsPatch(business, data) {
  const existingKey = business.program_json?.external_awards?.api_key;
  const external = /** @type {{ enabled?: boolean, api_key?: string }} */ ({});
  // Disabling this hub stops its imports; legacy integrations retain their own switch.
  if (data.enabled) {
    external.enabled = true;
    if (!existingKey || String(existingKey).startsWith("enc:"))
      external.api_key = crypto.randomBytes(32).toString("hex");
  }
  return { existingKey, external };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {unknown} input owner settings body, validated by SettingsSchema
 */
async function configurePosIntegrationWithDeps(deps, id, input) {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success)
    throw badRequest("Revisa el tipo de conexión, la activación y las credenciales.");
  return deps.lock(id, async () => {
    const business = await loadBusiness(deps, id);
    if (!(await deps.hasFeature(business))) throw forbidden("Tu plan no permite conexiones POS.");
    /** @type {Partial<PosIntegrationConfig>} */
    const current = business.program_json?.pos_integration ?? {};
    const data = parsed.data;
    const native = await resolveLoyverseCredentials(deps, business, data, current);
    const next = nextPosIntegrationSettings(deps, business, data, current, native);
    const { existingKey, external } = externalAwardsPatch(business, data);
    await deps.saveSettings(
      id,
      { pos_integration: next, ...(data.enabled ? { external_awards: external } : {}) },
      { initializeExternalKey: !existingKey },
    );
    return readPosIntegration(deps, id);
  });
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 */
async function rotatePosKeyWithDeps(deps, id) {
  return deps.lock(id, async () => {
    const business = await loadBusiness(deps, id);
    if (!(await deps.hasFeature(business))) throw forbidden("Tu plan no permite conexiones POS.");
    const apiKey = crypto.randomBytes(32).toString("hex");
    await deps.saveSettings(id, { external_awards: { api_key: apiKey } });
    return {
      ok: true,
      api_key: apiKey,
      integration: (await readPosIntegration(deps, id)).integration,
    };
  });
}

// --- preview / prepare -------------------------------------------------------

const IGNORED_ISSUE_CODES = [
  "refund",
  "cancelled",
  "historic_sale",
  "store_mismatch",
  "receipt_not_found",
];

/**
 * @param {PosIntegrationIssue[]} issues
 * @returns {PosIntegrationPreviewRow[]}
 */
function issueRows(issues) {
  return issues.map((issue) => ({
    ...issue,
    row: issue.row ?? null,
    customerPhone: "",
    amountQ: null,
    points: 0,
    status: issue.status ?? (IGNORED_ISSUE_CODES.includes(issue.code) ? "ignored" : "error"),
  }));
}

/**
 * @param {PosIntegrationIssue[]} issues
 * @returns {PosIntegrationReceipt[]}
 */
function issueReceipts(issues) {
  const unmatchedCodes = new Set([
    "missing_customer",
    "customer_not_found",
    "missing_phone",
    "invalid_phone",
  ]);
  // Cancelled/refund/nonpaid records and receipts outside this import's scope
  // do not establish a missing purchase. Keep genuine sale failures visible.
  const nonPurchaseCodes = new Set([
    "refund",
    "cancelled",
    "historic_sale",
    "store_mismatch",
    "receipt_not_found",
    "unsupported_receipt",
    "UNPAID_STATUS",
  ]);
  return /** @type {PosIntegrationReceipt[]} */ (
    issues
      .filter((issue) => issue.source && !nonPurchaseCodes.has(issue.code))
      .map((issue) =>
        posMeasurementReceipt(issue, unmatchedCodes.has(issue.code) ? "unmatched" : "rejected"),
      )
      .filter(Boolean)
  );
}

// Classifies one sale as ready / duplicate / error and derives its measurement
// receipt. Only ready sales produce an entry for apply().
/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationSale} input
 */
async function evaluateSaleRow(deps, business, input) {
  const receipt = posMeasurementReceipt(input);
  const row = {
    row: input.row ?? null,
    saleId: input.saleId ?? "",
    customerPhone: input.customerPhone ?? "",
    amountQ: input.amountQ,
    points: 0,
    status: "ready",
    code: "",
    message: "Lista para sumar puntos.",
  };
  /** @type {PosIntegrationReadyEntry | null} */
  let ready = null;
  try {
    const sale = normalizePosSale(input, business);
    const customer = await deps.getCustomer(business.id, sale.customerPhone);
    if (!customer || customer.business_id !== business.id)
      throw notFound(
        "El cliente no está registrado en este negocio. Regístralo con este teléfono y vuelve a importar.",
      );
    const meta = {
      pos_sale: {
        saleId: sale.saleId,
        source: sale.source,
        customerPhone: sale.customerPhone,
        amountQ: sale.amountQ,
        items: sale.items,
        ...(sale.currency !== "GTQ" ? { currency: sale.currency } : {}),
      },
    };
    const existing = await deps.findTransaction(business.id, posEventId(sale));
    if (existing) {
      assertPurchaseTimeReplay(existing, sale.occurredAt);
      if (
        existing.customer_id !== customer.id ||
        !Object.entries(meta.pos_sale).every(
          ([key, value]) => existing.meta?.pos_sale?.[key] === value,
        )
      )
        throw conflict(
          "Este ID de venta ya se usó con otros datos. Revisa la venta antes de ajustar sus puntos.",
        );
      Object.assign(row, {
        status: "duplicate",
        points: Number(existing.points),
        message: "Esta venta ya fue procesada; no se sumará otra vez.",
      });
      if (receipt)
        Object.assign(receipt, { status: "matched", transactionId: existing.id ?? null });
    } else {
      if (business.program_type === "ITEM" && sale.items < 1)
        throw badRequest("Este programa requiere la cantidad entera de artículos vendidos.");
      row.points = computePoints(business, {
        amount_q: sale.amountQ,
        visits: 1,
        items: sale.items,
      });
      if (!isLedgerInteger(row.points))
        throw badRequest(
          "Revisa las reglas de puntos de este programa; el resultado supera el límite permitido.",
        );
      ready = { row, sale, meta, receipt };
    }
    row.customerPhone = sale.customerPhone;
  } catch (error) {
    const statusCode = errorStatus(error);
    if (!statusCode || statusCode >= 500) throw error;
    Object.assign(row, {
      status: "error",
      code: `SALE_${statusCode}`,
      message: errorMessage(error),
    });
    if (receipt) receipt.status = statusCode === 404 ? "unmatched" : "rejected";
  }
  return { row, receipt, ready };
}

/**
 * @param {PosIntegrationPreviewRow[]} rows
 * @returns {PosIntegrationSummary}
 */
function summarizeRows(rows) {
  const summary = { total: rows.length, ready: 0, errors: 0, ignored: 0, duplicates: 0 };
  for (const row of rows)
    summary[
      /** @type {Record<string, keyof typeof summary>} */ ({
        ready: "ready",
        error: "errors",
        ignored: "ignored",
        duplicate: "duplicates",
      })[row.status]
    ] += 1;
  return summary;
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationSale[]} sales
 * @param {PosIntegrationIssue[]} [issues]
 * @param {string[]} [headers]
 */
async function prepareSales(deps, business, sales, issues = [], headers = []) {
  const rows = issueRows(issues);
  /** @type {PosIntegrationReadyEntry[]} */
  const ready = [];
  const receipts = issueReceipts(issues);
  for (const input of sales) {
    const { row, receipt, ready: entry } = await evaluateSaleRow(deps, business, input);
    if (entry) ready.push(entry);
    if (receipt) receipts.push(receipt);
    rows.push(row);
  }
  rows.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { preview: { ok: true, headers, rows, summary: summarizeRows(rows) }, ready, receipts };
}

// --- apply -------------------------------------------------------------------

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationApplyResult} result
 * @param {PosIntegrationReadyEntry} entry
 */
async function awardPreparedSale(deps, business, result, { sale, meta, row, receipt }) {
  try {
    const award = await deps.award({
      businessSlug: business.slug,
      externalEventId: posEventId(sale),
      customerPhone: sale.customerPhone,
      amount_q: sale.amountQ,
      expectedCurrency: sale.currency,
      visits: 1,
      items: sale.items,
      meta,
      purchaseOccurredAt: sale.occurredAt,
      purchaseTimeSource: "pos_receipt",
    });
    if (award.replay) result.duplicates += 1;
    else result.awarded += 1;
    if (receipt)
      Object.assign(receipt, { status: "matched", transactionId: award.transactionId ?? null });
  } catch (error) {
    const statusCode = errorStatus(error);
    if (!statusCode || statusCode >= 500) throw error;
    result.errors += 1;
    result.issues.push({
      row: row.row,
      saleId: sale.saleId,
      code: `SALE_${statusCode}`,
      message:
        statusCode === 409
          ? "La venta ya existe con otros datos; revisa el registro."
          : "No se pudo registrar esta venta. Revisa el cliente y la conexión.",
    });
    if (receipt) receipt.status = statusCode === 404 ? "unmatched" : "rejected";
  }
  if (receipt) await deps.recordReceipts(business.id, [receipt]);
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {Awaited<ReturnType<typeof prepareSales>>} prepared
 */
async function applyPrepared(deps, business, prepared) {
  const result = resultFromPreview(prepared.preview);
  // Commit input evidence before attempting awards, so a ledger failure cannot
  // erase the fact that this adapter sent a receipt. Previews never call apply.
  await deps.recordReceipts(business.id, prepared.receipts);
  for (const entry of prepared.ready) await awardPreparedSale(deps, business, result, entry);
  return result;
}

// --- CSV / API imports -------------------------------------------------------

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {Parameters<typeof normalizePosCsv>[0]} input
 */
async function previewCsvWithDeps(deps, id, input) {
  const business = await loadBusiness(deps, id);
  const parsed = normalizePosCsv(input, businessRegion(business));
  return (await prepareSales(deps, business, parsed.sales, parsed.issues, parsed.headers)).preview;
}

// Owner-only read preview: deliberately independent of enabled state, API
// credentials and apply(). It cannot activate a connection or award points.
/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {unknown} input sample sale body, validated by PreflightSchema
 */
async function previewPosSaleWithDeps(deps, id, input) {
  const parsed = PreflightSchema.safeParse(input);
  if (!parsed.success)
    throw badRequest(
      "Revisa la muestra: ID y origen de la venta, teléfono, monto en la moneda del negocio, estado paid/completed y cantidad entera de artículos. No incluyas otros campos.",
    );
  const business = await loadBusiness(deps, id);
  const sale = normalizePosSale(parsed.data, business);
  if (business.id !== id) throw notFound("Negocio no encontrado.");
  if (!(await deps.hasFeature(business))) throw forbidden("Tu plan no permite conexiones POS.");
  return { ...(await prepareSales(deps, business, [sale])).preview, dryRun: true };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {Parameters<typeof normalizePosCsv>[0] | null | undefined} input
 */
async function importCsvWithDeps(deps, id, input) {
  return deps.lock(id, async () => {
    const business = await loadBusiness(deps, id);
    await requireEnabled(deps, business, "csv");
    if (!input?.columns)
      throw badRequest("Selecciona las columnas y revisa la vista previa antes de importar.");
    const parsed = normalizePosCsv(input, businessRegion(business));
    return {
      ok: true,
      result: await applyPrepared(
        deps,
        business,
        await prepareSales(deps, business, parsed.sales, parsed.issues, parsed.headers),
      ),
    };
  });
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 * @param {Record<string, any> | null | undefined} input untrusted sale body from the POS adapter
 * @returns {Promise<PosIntegrationDryRunResponse | PosIntegrationApplyResponse>}
 */
async function ingestPosSaleWithDeps(deps, business, input) {
  await requireEnabled(deps, business, "api");
  if (input?.dryRun !== undefined && typeof input.dryRun !== "boolean")
    throw badRequest("dryRun debe ser true o false.");
  if (!input || !["paid", "completed"].includes(input.status)) {
    throw badRequest("Solo se aceptan ventas pagadas: status debe ser paid o completed.");
  }
  let sale;
  try {
    sale = normalizePosSale(input, business);
  } catch (error) {
    const receipt = posMeasurementReceipt(input, "rejected");
    if (input.dryRun !== true && receipt) await deps.recordReceipts(business.id, [receipt]);
    throw error;
  }
  if (input.dryRun === true)
    return { ...(await prepareSales(deps, business, [sale])).preview, dryRun: true };
  return deps.lock(business.id, async () => {
    const current = await loadBusiness(deps, business.id);
    await requireEnabled(deps, current, "api");
    const result = await applyPrepared(deps, current, await prepareSales(deps, current, [sale]));
    if (result.awarded || result.duplicates) await deps.reconcileSaleRefunds(current.id, sale);
    return { ok: true, result };
  });
}

// --- Loyverse ----------------------------------------------------------------

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationConfig} cfg
 * @returns {PosIntegrationSyncWindow}
 */
function nativeSyncWindow(deps, cfg) {
  return (
    cfg.sync_window ?? {
      since: new Date(
        Math.max(
          Date.parse(cfg.connected_at),
          Date.parse(cfg.last_completed_at || cfg.connected_at) - 300000,
        ),
      ).toISOString(),
      until: deps.now().toISOString(),
      cursor: null,
    }
  );
}

// Prefer the fresh lookup, and avoid awarding the same receipt twice within a batch.
/**
 * @param {PosIntegrationFetchedPage} page mutated in place
 * @param {PosIntegrationFetchedPage} retried
 * @param {string[]} retryIds
 */
function mergeRetriedReceipts(page, retried, retryIds) {
  const replaced = new Set(retryIds);
  page.sales = [...page.sales.filter((sale) => !replaced.has(sale.saleId)), ...retried.sales];
  page.issues = [...page.issues.filter((issue) => !replaced.has(issue.saleId)), ...retried.issues];
  page.refunds = [
    ...(page.refunds ?? []).filter((refund) => !replaced.has(refund.refundId)),
    ...(retried.refunds ?? []),
  ];
}

/**
 * @param {PosIntegrationFetchedPage} page
 * @param {PosIntegrationConfig} cfg
 */
function partitionHistoricSales(page, cfg) {
  const sales = [],
    issues = [...page.issues];
  for (const sale of page.sales) {
    if (
      !sale.occurredAt ||
      !Number.isFinite(Date.parse(sale.occurredAt)) ||
      Date.parse(sale.occurredAt) < Date.parse(cfg.connected_at)
    )
      issues.push({
        saleId: sale.saleId,
        source: sale.source,
        occurredAt: sale.occurredAt,
        code: "historic_sale",
        message: "Venta anterior a la activación; no se importó automáticamente.",
      });
    else sales.push(sale);
  }
  return { sales, issues };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationBusiness} business
 */
async function loadNativePage(deps, business) {
  /** @type {PosIntegrationConfig | undefined} */
  const cfg = business.program_json?.pos_integration;
  if (!cfg?.loyverse?.access_token || String(cfg.loyverse.access_token).startsWith("enc:"))
    throw badRequest("Conecta tu cuenta de Loyverse primero.");
  if (!cfg.connected_at || !Number.isFinite(Date.parse(cfg.connected_at)))
    throw badRequest("Guarda la conexión para iniciar la sincronización.");
  const window = nativeSyncWindow(deps, cfg);
  const auth = {
    accessToken: cfg.loyverse.access_token,
    merchantId: cfg.loyverse.merchant_id,
    storeId: cfg.loyverse.store_id,
    region: businessRegion(business),
  };
  const page = await deps.fetchSales({ ...auth, ...window });
  const retryIds = (cfg.pending_receipts ?? []).slice(0, 25);
  if (retryIds.length) {
    const retried = await deps.fetchRetrySales({ ...auth, receiptIds: retryIds });
    mergeRetriedReceipts(page, retried, retryIds);
  }
  const { sales, issues } = partitionHistoricSales(page, cfg);
  return {
    sales,
    issues,
    refunds: page.refunds ?? [],
    nextCursor: page.nextCursor,
    window,
    attemptedIds: [
      ...retryIds,
      ...page.sales.map((sale) => sale.saleId),
      ...page.issues.map((issue) => issue.saleId),
      ...(page.refunds ?? []).map((refund) => refund.refundId),
    ],
  };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 */
async function previewLoyverseWithDeps(deps, id) {
  const business = await loadBusiness(deps, id);
  await requireEnabled(deps, business, "loyverse");
  const page = await loadNativePage(deps, business);
  return {
    ...(await prepareSales(deps, business, page.sales, page.issues)).preview,
    refund_count: page.refunds.length,
    has_more: !!page.nextCursor,
  };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {Awaited<ReturnType<typeof loadNativePage>>} page
 */
async function enqueueLoyverseRefunds(deps, id, page) {
  const queuedRefunds = [];
  for (const { nativeEvidence, ...refund } of page.refunds)
    queuedRefunds.push(
      await deps.enqueueRefund(id, refund, { origin: "loyverse", nativeEvidence }),
    );
  return queuedRefunds;
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {Awaited<ReturnType<typeof enqueueLoyverseRefunds>>} queuedRefunds
 * @param {PosIntegrationSyncResult} result mutated with the refund counters
 */
async function reconcileQueuedRefunds(deps, id, queuedRefunds, result) {
  const reconciledRefunds = [];
  for (const receipt of queuedRefunds)
    reconciledRefunds.push(await deps.reconcileRefund(id, receipt.refund.id, { automatic: true }));
  await deps.retryRefunds(id);
  Object.assign(result, {
    refunds_received: queuedRefunds.length,
    refunds_reconciled: reconciledRefunds.filter((value) => value.refund.status === "reconciled")
      .length,
    refunds_pending: reconciledRefunds.filter((value) => value.refund.status === "pending").length,
  });
}

// Preserve every unresolved old ID before admitting new IDs; rotate retries fairly.
/**
 * @param {PosIntegrationConfig} cfg
 * @param {Awaited<ReturnType<typeof loadNativePage>>} page
 * @param {PosIntegrationApplyResult} result
 * @returns {string[]}
 */
function pendingReceiptQueue(cfg, page, result) {
  const ignoredCodes = new Set(IGNORED_ISSUE_CODES);
  const attempted = new Set(page.attemptedIds);
  const failures = new Set(
    result.issues
      .filter((issue) => issue.saleId && !ignoredCodes.has(issue.code))
      .map((issue) => issue.saleId),
  );
  const existingPending = cfg.pending_receipts ?? [];
  return [
    ...new Set([
      ...existingPending.filter((id) => !attempted.has(id)),
      ...existingPending.filter((id) => attempted.has(id) && failures.has(id)),
      ...failures,
    ]),
  ];
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {PosIntegrationConfig} cfg
 * @param {Awaited<ReturnType<typeof loadNativePage>>} page
 * @param {PosIntegrationSyncResult} result
 * @param {string[]} pending
 * @param {boolean} overflow
 */
function completedSyncPatch(deps, cfg, page, result, pending, overflow) {
  const lastSync = {
    at: deps.now().toISOString(),
    status: result.errors || result.issues.length || result.refunds_pending ? "attention" : "ok",
    ...result,
    issues: result.issues.slice(0, 25),
  };
  return {
    last_sync: { ...lastSync, pending: pending.length },
    pending_receipts: pending.slice(0, 500),
    sync_window: overflow
      ? page.window
      : page.nextCursor
        ? { ...page.window, cursor: page.nextCursor }
        : null,
    last_completed_at:
      overflow || page.nextCursor ? (cfg.last_completed_at ?? null) : page.window.until,
  };
}

/** @param {PosIntegrationDeps} deps */
function failedSyncPatch(deps) {
  return {
    last_sync: {
      at: deps.now().toISOString(),
      status: "error",
      awarded: 0,
      duplicates: 0,
      ignored: 0,
      errors: 1,
      issues: [
        {
          saleId: "",
          code: "SYNC_FAILED",
          message:
            "No se completó la sincronización. Revisa el acceso a Loyverse y vuelve a intentar; las ventas procesadas no se duplicarán.",
        },
      ],
      has_more: true,
    },
  };
}

// One Loyverse page: refunds queued, sales awarded, refunds reconciled, retry
// queue rotated and the sync cursor persisted.
/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {PosIntegrationBusiness} business
 * @param {PosIntegrationConfig} cfg
 */
async function syncLoyversePage(deps, id, business, cfg) {
  const page = await loadNativePage(deps, business);
  const queuedRefunds = await enqueueLoyverseRefunds(deps, id, page);
  const prepared = await prepareSales(deps, business, page.sales, page.issues);
  const result = {
    ...(await applyPrepared(deps, business, prepared)),
    has_more: !!page.nextCursor,
    refunds_received: 0,
    refunds_reconciled: 0,
    refunds_pending: 0,
  };
  await reconcileQueuedRefunds(deps, id, queuedRefunds, result);
  const pending = pendingReceiptQueue(cfg, page, result);
  // Keep the scan at this page if the recovery queue cannot safely retain every failure.
  const overflow = pending.length > 500;
  if (overflow)
    result.issues.unshift({
      row: null,
      saleId: "",
      code: "RETRY_QUEUE_FULL",
      message:
        "Hay más de 500 ventas por corregir. Revisa los clientes antes de avanzar; este grupo se volverá a consultar.",
    });
  result.has_more ||= overflow;
  await deps.saveSync(
    id,
    cfg.revision,
    completedSyncPatch(deps, cfg, page, result, pending, overflow),
  );
  return { ok: true, result };
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 * @param {{ automatic?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, result: PosIntegrationSyncResult }>}
 */
async function syncLoyverseBusinessWithDeps(deps, id, { automatic = false } = {}) {
  return deps.lock(id, async () => {
    const business = await loadBusiness(deps, id);
    await requireEnabled(deps, business, "loyverse");
    /** @type {PosIntegrationConfig} */
    const cfg = business.program_json.pos_integration;
    if (automatic && cfg.automatic !== true)
      return {
        ok: true,
        result: { awarded: 0, duplicates: 0, errors: 0, ignored: 0, issues: [], has_more: false },
      };
    try {
      return await syncLoyversePage(deps, id, business, cfg);
    } catch (error) {
      await deps.saveSync(id, cfg.revision, failedSyncPatch(deps));
      throw error;
    }
  });
}

/**
 * @param {PosIntegrationDeps} deps
 * @param {string} id
 */
async function retryPosRefundsWithDeps(deps, id) {
  return deps.lock(id, async () => {
    await requireEnabled(deps, await loadBusiness(deps, id));
    return deps.retryRefunds(id);
  });
}

/** @param {Partial<PosIntegrationDeps>} [overrides] */
export function createPosIntegrationService(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  return {
    /** @param {string} id */
    getPosIntegration: (id) => readPosIntegration(deps, id),
    /** @param {string} id @param {unknown} input */
    configurePosIntegration: (id, input) => configurePosIntegrationWithDeps(deps, id, input),
    /** @param {string} id */
    rotatePosKey: (id) => rotatePosKeyWithDeps(deps, id),
    /** @param {string} id @param {Parameters<typeof normalizePosCsv>[0]} input */
    previewCsv: (id, input) => previewCsvWithDeps(deps, id, input),
    /** @param {string} id @param {unknown} input */
    previewPosSale: (id, input) => previewPosSaleWithDeps(deps, id, input),
    /** @param {string} id @param {Parameters<typeof normalizePosCsv>[0] | null | undefined} input */
    importCsv: (id, input) => importCsvWithDeps(deps, id, input),
    /** @param {PosIntegrationBusiness} business @param {Record<string, any> | null | undefined} input */
    ingestPosSale: (business, input) => ingestPosSaleWithDeps(deps, business, input),
    /** @param {string} id */
    previewLoyverse: (id) => previewLoyverseWithDeps(deps, id),
    /** @param {string} id @param {{ automatic?: boolean }} [options] */
    syncLoyverseBusiness: (id, options) => syncLoyverseBusinessWithDeps(deps, id, options),
    /** @param {string} id */
    retryPosRefunds: (id) => retryPosRefundsWithDeps(deps, id),
  };
}

export const {
  getPosIntegration,
  configurePosIntegration,
  rotatePosKey,
  previewCsv,
  previewPosSale,
  importCsv,
  ingestPosSale,
  previewLoyverse,
  syncLoyverseBusiness,
  retryPosRefunds,
} = createPosIntegrationService();

let polling = false;
export async function syncConfiguredPosOnce() {
  if (polling) return;
  polling = true;
  try {
    const ids = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const { rows } = await dbQuery(`SELECT b.id,
        (b.program_json#>>'{pos_integration,automatic}'='true' AND b.program_json#>>'{pos_integration,mode}'='loyverse') AS sync_native
        FROM businesses b WHERE b.program_json#>>'{pos_integration,enabled}'='true' AND b.program_json#>>'{external_awards,enabled}'='true'
        AND ((b.program_json#>>'{pos_integration,automatic}'='true' AND b.program_json#>>'{pos_integration,mode}'='loyverse')
          OR EXISTS(SELECT 1 FROM pos_refund_receipts r WHERE r.business_id=b.id AND r.status='pending'
            AND r.reason IN('awaiting_reconciliation','original_not_found','retryable_error') AND r.attempts<10
            AND (r.last_attempt_at IS NULL OR r.last_attempt_at<now()-interval '1 minute')))`);
      return rows;
    });
    for (const { id, sync_native: syncNative } of ids) {
      try {
        if (syncNative) await syncLoyverseBusiness(id, { automatic: true });
        else await retryPosRefunds(id);
      } catch {
        logger.warn({ businessId: id }, "POS sync did not complete; inspect connection status");
      }
    }
  } finally {
    polling = false;
  }
}
