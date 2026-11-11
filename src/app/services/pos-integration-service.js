import {businessRegion} from './regional-settings.js';
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
import { fetchLoyverseSales, fetchLoyverseSalesByReceiptIds, verifyLoyverseConnection } from "./pos/loyverse.js";
import { enqueuePosRefund, reconcilePosRefund, retryPendingPosRefunds, reconcilePendingRefundsForSale } from "./pos-refund-service.js";

const SettingsSchema = z.object({
  enabled: z.boolean(), mode: z.enum(["api", "csv", "loyverse"]), automatic: z.boolean().optional(),
  loyverse: z.object({ access_token: z.string().trim().min(1).max(4096).optional(), store_id: z.string().trim().max(128).nullable().optional() }).strict().optional()
}).strict();

const PreflightSchema = z.object({
  saleId: z.string().min(1).max(200),
  source: z.string().min(1).max(180),
  customerPhone: z.string().min(1).max(40),
  amountQ: z.number().finite().min(0).max(99999999.99),
  currency: z.string().regex(/^[A-Z]{3}$/),
  status: z.enum(["paid", "completed"]),
  items: z.number().int().min(0).max(2147483647).optional()
}).strict();

async function withPosLock(businessId, fn) {
  return withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
    const { rows } = await dbQuery("SELECT pg_try_advisory_lock(hashtext('pos-integration'), hashtext($1)) AS locked", [businessId]);
    if (!rows[0]?.locked) throw conflict("Hay una importación o conexión en curso. Espera unos segundos y vuelve a intentar.");
    try { return await fn(); }
    finally { await dbQuery("SELECT pg_advisory_unlock(hashtext('pos-integration'), hashtext($1))", [businessId]); }
  });
}

const defaultDeps = {
  getBusiness: (id) => BusinessRepo.getById(id),
  getCustomer: (businessId, phone) => CustomerRepo.getByBusinessAndPhone(businessId, phone),
  findTransaction: async (businessId, eventId) => {
    const { rows } = await dbQuery("SELECT customer_id, points, meta FROM transactions WHERE business_id=$1 AND source='external' AND meta->>'external_event_id'=$2 LIMIT 1", [businessId, eventId]);
    return rows[0] ?? null;
  },
  saveSettings: async (businessId, patch, { initializeExternalKey = false } = {}) => {
    // Merge only submitted external fields under the row lock so a concurrent
    // legacy settings write cannot be replaced by an earlier business snapshot.
    await dbQuery(`UPDATE businesses SET program_json =
      COALESCE(program_json, '{}'::jsonb) || ($2::jsonb - 'external_awards') ||
      CASE WHEN $2::jsonb ? 'external_awards' THEN jsonb_build_object('external_awards',
        (CASE WHEN jsonb_typeof(program_json->'external_awards') = 'object' THEN program_json->'external_awards' ELSE '{}'::jsonb END) ||
        (CASE WHEN $3::boolean AND NULLIF(program_json#>>'{external_awards,api_key}', '') IS NOT NULL
          THEN ($2::jsonb->'external_awards') - 'api_key' ELSE $2::jsonb->'external_awards' END))
      ELSE '{}'::jsonb END, updated_at=now() WHERE id=$1`, [businessId, encryptProgramSecrets(patch), initializeExternalKey]);
  },
  saveSync: async (businessId, revision, patch) => {
    await dbQuery("UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_integration}',(program_json->'pos_integration') || $3::jsonb), updated_at=now() WHERE id=$1 AND program_json#>>'{pos_integration,revision}'=$2", [businessId, revision, patch]);
  },
  hasFeature: async (business) => hasPlanFeature(business.plan, "external_awards", await PlanConfigService.getPlanFeatureOverrides()),
  lock: withPosLock,
  award: awardFromExternalEventTrusted,
  verifyConnection: verifyLoyverseConnection,
  fetchSales: fetchLoyverseSales,
  fetchRetrySales: fetchLoyverseSalesByReceiptIds,
  enqueueRefund: enqueuePosRefund,
  reconcileRefund: reconcilePosRefund,
  retryRefunds: retryPendingPosRefunds,
  reconcileSaleRefunds: reconcilePendingRefundsForSale,
  now: () => new Date()
};

function resultFromPreview(preview) {
  return { awarded: 0, duplicates: preview.summary.duplicates, errors: preview.summary.errors, ignored: preview.summary.ignored, issues: preview.rows.filter((row) => row.status !== "ready" && row.status !== "duplicate").map(({ row, saleId, code, message }) => ({ row, saleId, code, message })) };
}

export function createPosIntegrationService(overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  async function getBusiness(id) {
    const business = await deps.getBusiness(id);
    if (!business) throw notFound("Negocio no encontrado.");
    return business;
  }
  async function requireEnabled(business, mode) {
    const cfg = business.program_json?.pos_integration;
    if (!cfg?.enabled || !business.program_json?.external_awards?.enabled || (mode && cfg.mode !== mode)) throw forbidden("Activa y guarda este tipo de conexión antes de importar ventas.");
    if (!await deps.hasFeature(business)) throw forbidden("Tu plan no permite conexiones POS.");
  }
  const response = (business) => ({ ok: true, business: { slug: business.slug }, integration: safePosIntegration(business) });

  async function getPosIntegration(id) { return response(await getBusiness(id)); }

  async function configurePosIntegration(id, input) {
    const parsed = SettingsSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Revisa el tipo de conexión, la activación y las credenciales.");
    return deps.lock(id, async () => {
      const business = await getBusiness(id);
      if (!await deps.hasFeature(business)) throw forbidden("Tu plan no permite conexiones POS.");
      const current = business.program_json?.pos_integration ?? {};
      const data = parsed.data;
      let native = { ...(current.loyverse ?? {}) };
      const accessToken = data.loyverse?.access_token ?? native.access_token;
      const storeId = data.loyverse?.store_id === undefined ? native.store_id : (data.loyverse.store_id || null);
      if (data.loyverse?.access_token || storeId !== native.store_id || (data.mode === "loyverse" && data.enabled)) {
        if (!accessToken || String(accessToken).startsWith("enc:")) throw badRequest("Agrega un token de lectura de Loyverse para conectar.");
        let verified;
        try { verified = await deps.verifyConnection({ accessToken, storeId, region:businessRegion(business) }); }
        catch (error) { throw badRequest(error.message); }
        native = { access_token: accessToken, merchant_id: verified.merchantId, merchant_name: verified.merchantName, store_id: verified.storeId };
      }
      const reset = data.enabled && (!current.enabled || !business.program_json?.external_awards?.enabled || current.mode !== data.mode || current.loyverse?.merchant_id !== native.merchant_id || current.loyverse?.store_id !== native.store_id);
      const next = { ...current, enabled: data.enabled, mode: data.mode, automatic: data.automatic ?? current.automatic ?? false, loyverse: native, revision: crypto.randomUUID() };
      if (reset || !next.connected_at) Object.assign(next, { connected_at: deps.now().toISOString(), last_completed_at: null, sync_window: null, last_sync: null, pending_receipts: [] });
      const existingKey = business.program_json?.external_awards?.api_key;
      const external = /** @type {{ enabled?: boolean, api_key?: string }} */ ({});
      // Disabling this hub stops its imports; legacy integrations retain their own switch.
      if (data.enabled) {
        external.enabled = true;
        if (!existingKey || String(existingKey).startsWith("enc:")) external.api_key = crypto.randomBytes(32).toString("hex");
      }
      await deps.saveSettings(id, { pos_integration: next, ...(data.enabled ? { external_awards: external } : {}) }, { initializeExternalKey: !existingKey });
      return getPosIntegration(id);
    });
  }

  async function rotatePosKey(id) {
    return deps.lock(id, async () => {
      const business = await getBusiness(id);
      if (!await deps.hasFeature(business)) throw forbidden("Tu plan no permite conexiones POS.");
      const apiKey = crypto.randomBytes(32).toString("hex");
      await deps.saveSettings(id, { external_awards: { api_key: apiKey } });
      return { ok: true, api_key: apiKey, integration: (await getPosIntegration(id)).integration };
    });
  }

  async function prepare(business, sales, issues = [], headers = []) {
    const rows = issues.map((issue) => ({ ...issue, row: issue.row ?? null, customerPhone: "", amountQ: null, points: 0, status: issue.status ?? (["refund", "cancelled", "historic_sale", "store_mismatch", "receipt_not_found"].includes(issue.code) ? "ignored" : "error") }));
    const ready = [];
    for (const input of sales) {
      const row = { row: input.row ?? null, saleId: input.saleId ?? "", customerPhone: input.customerPhone ?? "", amountQ: input.amountQ, points: 0, status: "ready", code: "", message: "Lista para sumar puntos." };
      try {
        const sale = normalizePosSale(input,business);
        const customer = await deps.getCustomer(business.id, sale.customerPhone);
        if (!customer || customer.business_id !== business.id) throw notFound("El cliente no está registrado en este negocio. Regístralo con este teléfono y vuelve a importar.");
        const meta = { pos_sale: { saleId: sale.saleId, source: sale.source, customerPhone: sale.customerPhone, amountQ: sale.amountQ, items: sale.items, ...(sale.currency!=="GTQ"?{currency:sale.currency}:{}) } };
        const existing = await deps.findTransaction(business.id, posEventId(sale));
        if (existing) {
          if (existing.customer_id !== customer.id || !Object.entries(meta.pos_sale).every(([key, value]) => existing.meta?.pos_sale?.[key] === value)) throw conflict("Este ID de venta ya se usó con otros datos. Revisa la venta antes de ajustar sus puntos.");
          Object.assign(row, { status: "duplicate", points: Number(existing.points), message: "Esta venta ya fue procesada; no se sumará otra vez." });
        } else {
          if (business.program_type === "ITEM" && sale.items < 1) throw badRequest("Este programa requiere la cantidad entera de artículos vendidos.");
          row.points = computePoints(business, { amount_q: sale.amountQ, visits: 1, items: sale.items });
          if (!isLedgerInteger(row.points)) throw badRequest("Revisa las reglas de puntos de este programa; el resultado supera el límite permitido.");
          ready.push({ row, sale, meta });
        }
        row.customerPhone = sale.customerPhone;
      } catch (error) {
        if (!error.statusCode || error.statusCode >= 500) throw error;
        Object.assign(row, { status: "error", code: `SALE_${error.statusCode}`, message: error.message });
      }
      rows.push(row);
    }
    rows.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
    const summary = { total: rows.length, ready: 0, errors: 0, ignored: 0, duplicates: 0 };
    for (const row of rows) summary[{ ready: "ready", error: "errors", ignored: "ignored", duplicate: "duplicates" }[row.status]] += 1;
    return { preview: { ok: true, headers, rows, summary }, ready };
  }

  async function apply(business, prepared) {
    const result = resultFromPreview(prepared.preview);
    for (const { sale, meta, row } of prepared.ready) {
      try {
        const award = await deps.award({ businessSlug: business.slug, externalEventId: posEventId(sale), customerPhone: sale.customerPhone, amount_q: sale.amountQ, expectedCurrency: sale.currency, visits: 1, items: sale.items, meta });
        if (award.replay) result.duplicates += 1;
        else result.awarded += 1;
      } catch (error) {
        if (!error.statusCode || error.statusCode >= 500) throw error;
        result.errors += 1;
        result.issues.push({ row: row.row, saleId: sale.saleId, code: `SALE_${error.statusCode}`, message: error.statusCode === 409 ? "La venta ya existe con otros datos; revisa el registro." : "No se pudo registrar esta venta. Revisa el cliente y la conexión." });
      }
    }
    return result;
  }

  async function previewCsv(id, input) {
    const business = await getBusiness(id);
    const parsed = normalizePosCsv(input,businessRegion(business));
    return (await prepare(business, parsed.sales, parsed.issues, parsed.headers)).preview;
  }
  // Owner-only read preview: deliberately independent of enabled state, API
  // credentials and apply(). It cannot activate a connection or award points.
  async function previewPosSale(id, input) {
    const parsed = PreflightSchema.safeParse(input);
    if (!parsed.success) throw badRequest("Revisa la muestra: ID y origen de la venta, teléfono, monto en la moneda del negocio, estado paid/completed y cantidad entera de artículos. No incluyas otros campos.");
    const business = await getBusiness(id);
    const sale = normalizePosSale(parsed.data,business);
    if (business.id !== id) throw notFound("Negocio no encontrado.");
    if (!await deps.hasFeature(business)) throw forbidden("Tu plan no permite conexiones POS.");
    return { ...(await prepare(business, [sale])).preview, dryRun: true };
  }
  async function importCsv(id, input) {
    return deps.lock(id, async () => {
      const business = await getBusiness(id);
      await requireEnabled(business, "csv");
      if (!input?.columns) throw badRequest("Selecciona las columnas y revisa la vista previa antes de importar.");
      const parsed = normalizePosCsv(input,businessRegion(business));
      return { ok: true, result: await apply(business, await prepare(business, parsed.sales, parsed.issues, parsed.headers)) };
    });
  }
  async function ingestPosSale(business, input) {
    await requireEnabled(business, "api");
    if (!input || !["paid", "completed"].includes(input.status)) throw badRequest("Solo se aceptan ventas pagadas: status debe ser paid o completed.");
    if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") throw badRequest("dryRun debe ser true o false.");
    const sale = normalizePosSale(input,business);
    if (input.dryRun === true) return { ...(await prepare(business, [sale])).preview, dryRun: true };
    return deps.lock(business.id, async () => {
      const current = await getBusiness(business.id);
      await requireEnabled(current, "api");
      const result = await apply(current, await prepare(current, [sale]));
      if (result.awarded || result.duplicates) await deps.reconcileSaleRefunds(current.id, sale);
      return { ok: true, result };
    });
  }

  async function nativePage(business) {
    const cfg = business.program_json?.pos_integration;
    if (!cfg?.loyverse?.access_token || String(cfg.loyverse.access_token).startsWith("enc:")) throw badRequest("Conecta tu cuenta de Loyverse primero.");
    if (!cfg.connected_at || !Number.isFinite(Date.parse(cfg.connected_at))) throw badRequest("Guarda la conexión para iniciar la sincronización.");
    const window = cfg.sync_window ?? { since: new Date(Math.max(Date.parse(cfg.connected_at), Date.parse(cfg.last_completed_at || cfg.connected_at) - 300000)).toISOString(), until: deps.now().toISOString(), cursor: null };
    const auth = { accessToken: cfg.loyverse.access_token, merchantId: cfg.loyverse.merchant_id, storeId: cfg.loyverse.store_id, region:businessRegion(business) };
    const page = await deps.fetchSales({ ...auth, ...window });
    const retryIds = (cfg.pending_receipts ?? []).slice(0, 25);
    if (retryIds.length) {
      const retried = await deps.fetchRetrySales({ ...auth, receiptIds: retryIds });
      // Prefer the fresh lookup, and avoid awarding the same receipt twice within a batch.
      const replaced = new Set(retryIds);
      page.sales = [...page.sales.filter((sale) => !replaced.has(sale.saleId)), ...retried.sales];
      page.issues = [...page.issues.filter((issue) => !replaced.has(issue.saleId)), ...retried.issues];
      page.refunds = [...(page.refunds ?? []).filter(refund => !replaced.has(refund.refundId)), ...(retried.refunds ?? [])];
    }
    const sales = [], issues = [...page.issues];
    for (const sale of page.sales) {
      if (!sale.occurredAt || !Number.isFinite(Date.parse(sale.occurredAt)) || Date.parse(sale.occurredAt) < Date.parse(cfg.connected_at)) issues.push({ saleId: sale.saleId, code: "historic_sale", message: "Venta anterior a la activación; no se importó automáticamente." });
      else sales.push(sale);
    }
    return { sales, issues, refunds: page.refunds ?? [], nextCursor: page.nextCursor, window, attemptedIds: [...retryIds, ...page.sales.map((sale) => sale.saleId), ...page.issues.map((issue) => issue.saleId), ...(page.refunds ?? []).map(refund => refund.refundId)] };
  }
  async function previewLoyverse(id) {
    const business = await getBusiness(id);
    await requireEnabled(business, "loyverse");
    const page = await nativePage(business);
    return { ...(await prepare(business, page.sales, page.issues)).preview, refund_count: page.refunds.length, has_more: !!page.nextCursor };
  }
  async function syncLoyverseBusiness(id, { automatic = false } = {}) {
    return deps.lock(id, async () => {
      const business = await getBusiness(id);
      await requireEnabled(business, "loyverse");
      const cfg = business.program_json.pos_integration;
      if (automatic && cfg.automatic !== true) return { ok: true, result: { awarded: 0, duplicates: 0, errors: 0, ignored: 0, issues: [], has_more: false } };
      try {
        const page = await nativePage(business);
        const queuedRefunds = [];
        for (const { nativeEvidence, ...refund } of page.refunds) queuedRefunds.push(await deps.enqueueRefund(id, refund, { origin: "loyverse", nativeEvidence }));
        const prepared = await prepare(business, page.sales, page.issues);
        const result = { ...await apply(business, prepared), has_more: !!page.nextCursor, refunds_received: 0, refunds_reconciled: 0, refunds_pending: 0 };
        const reconciledRefunds = [];
        for (const receipt of queuedRefunds) reconciledRefunds.push(await deps.reconcileRefund(id, receipt.refund.id, { automatic: true }));
        await deps.retryRefunds(id);
        Object.assign(result, { refunds_received: queuedRefunds.length,
          refunds_reconciled: reconciledRefunds.filter(value => value.refund.status === "reconciled").length,
          refunds_pending: reconciledRefunds.filter(value => value.refund.status === "pending").length });
        const ignoredCodes = new Set(["refund", "cancelled", "historic_sale", "store_mismatch", "receipt_not_found"]);
        const attempted = new Set(page.attemptedIds);
        const failures = new Set(result.issues.filter((issue) => issue.saleId && !ignoredCodes.has(issue.code)).map((issue) => issue.saleId));
        const existingPending = cfg.pending_receipts ?? [];
        // Preserve every unresolved old ID before admitting new IDs; rotate retries fairly.
        const pending = [...new Set([...existingPending.filter((id) => !attempted.has(id)), ...existingPending.filter((id) => attempted.has(id) && failures.has(id)), ...failures])];
        // Keep the scan at this page if the recovery queue cannot safely retain every failure.
        const overflow = pending.length > 500;
        if (overflow) result.issues.unshift({ row: null, saleId: "", code: "RETRY_QUEUE_FULL", message: "Hay más de 500 ventas por corregir. Revisa los clientes antes de avanzar; este grupo se volverá a consultar." });
        result.has_more ||= overflow;
        const lastSync = { at: deps.now().toISOString(), status: result.errors || result.issues.length || result.refunds_pending ? "attention" : "ok", ...result, issues: result.issues.slice(0, 25) };
        await deps.saveSync(id, cfg.revision, { last_sync: { ...lastSync, pending: pending.length }, pending_receipts: pending.slice(0, 500), sync_window: overflow ? page.window : page.nextCursor ? { ...page.window, cursor: page.nextCursor } : null, last_completed_at: overflow || page.nextCursor ? (cfg.last_completed_at ?? null) : page.window.until });
        return { ok: true, result };
      } catch (error) {
        await deps.saveSync(id, cfg.revision, { last_sync: { at: deps.now().toISOString(), status: "error", awarded: 0, duplicates: 0, ignored: 0, errors: 1, issues: [{ saleId: "", code: "SYNC_FAILED", message: "No se completó la sincronización. Revisa el acceso a Loyverse y vuelve a intentar; las ventas procesadas no se duplicarán." }], has_more: true } });
        throw error;
      }
    });
  }
  async function retryPosRefunds(id) {
    return deps.lock(id, async () => {
      await requireEnabled(await getBusiness(id));
      return deps.retryRefunds(id);
    });
  }
  return { getPosIntegration, configurePosIntegration, rotatePosKey, previewCsv, previewPosSale, importCsv, ingestPosSale, previewLoyverse, syncLoyverseBusiness, retryPosRefunds };
}

export const { getPosIntegration, configurePosIntegration, rotatePosKey, previewCsv, previewPosSale, importCsv, ingestPosSale, previewLoyverse, syncLoyverseBusiness, retryPosRefunds } = createPosIntegrationService();

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
      try { if (syncNative) await syncLoyverseBusiness(id, { automatic: true }); else await retryPosRefunds(id); }
      catch { logger.warn({ businessId: id }, "POS sync did not complete; inspect connection status"); }
    }
  } finally { polling = false; }
}
