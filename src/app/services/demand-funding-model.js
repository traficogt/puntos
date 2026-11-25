import { createHash } from "node:crypto";
import { badRequest, conflict } from "../../utils/http-error.js";
export const DEMAND_CATEGORIES = ["product", "reward", "availability", "service", "other"];
export const DEMAND_STATUSES = ["new", "reviewing", "planned", "available", "declined"];
/** @type {Record<string, string[]>} */
export const CLAIM_TRANSITIONS = {
  draft: ["submitted", "rejected"],
  submitted: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  rejected: ["submitted"],
  paid: [],
};
/**
 * @param {unknown} value
 * @param {number} [min]
 * @param {number} [max]
 */
export function demandText(value, min = 0, max = 1000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max)
    throw badRequest(`Escribe entre ${min} y ${max} caracteres.`);
  return text;
}
/**
 * @param {{
 *   category?: unknown,
 *   topic?: unknown,
 *   note?: unknown,
 *   productContext?: unknown,
 *   rewardId?: string | null,
 * }} input
 */
export function normalizeDemand(input) {
  const category = input.category,
    topic = demandText(input.topic, 3, 120).replace(/\s+/g, " "),
    note = demandText(input.note),
    productContext = demandText(input.productContext, 0, 200) || null,
    rewardId = input.rewardId ?? null;
  if (!(/** @type {unknown[]} */ (DEMAND_CATEGORIES).includes(category)))
    throw badRequest("Selecciona una categoría válida.");
  /** @param {string | null | undefined} value */
  const normalized = (value) =>
    (value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const topicKey = createHash("sha256")
    .update(JSON.stringify([category, normalized(topic), rewardId, normalized(productContext)]))
    .digest("hex");
  // category is one of DEMAND_CATEGORIES (checked above).
  return {
    category: /** @type {string} */ (category),
    topic,
    note,
    productContext,
    rewardId,
    topicKey,
  };
}
/**
 * @param {{ status: string, amount_minor: number | string }} row
 * @param {{ status: string, reference?: unknown, paid_minor?: unknown, paid_at?: unknown }} input
 */
export function validateClaimTransition(row, input) {
  if (!CLAIM_TRANSITIONS[row.status]?.includes(input.status))
    throw conflict("La transición no corresponde al estado actual de la reclamación.");
  const reference = demandText(input.reference, 3, 200);
  if (input.status === "paid") {
    if (!Number.isSafeInteger(input.paid_minor) || input.paid_minor !== Number(row.amount_minor))
      throw badRequest(
        "El importe recibido debe coincidir con el aprobado. Registra la diferencia con el proveedor antes de conciliar.",
      );
    const paidAt =
      typeof input.paid_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.paid_at)
        ? new Date(`${input.paid_at}T00:00:00Z`)
        : null;
    // paidAt exists only when paid_at is a YYYY-MM-DD string (checked above).
    if (
      !paidAt ||
      !Number.isFinite(paidAt.getTime()) ||
      paidAt.toISOString().slice(0, 10) !== input.paid_at ||
      /** @type {string} */ (input.paid_at) > new Date().toISOString().slice(0, 10)
    )
      throw badRequest("Registra una fecha real de pago, sin fechas futuras.");
  }
  return {
    status: input.status,
    reference,
    // Both were validated above for a paid transition: a safe integer and a date string.
    paid_minor: input.status === "paid" ? /** @type {number} */ (input.paid_minor) : null,
    paid_at: input.status === "paid" ? /** @type {string} */ (input.paid_at) : null,
  };
}
/**
 * Supplier claim row with its agreement and evidence, as the CSV export reads it.
 * @typedef {{
 *   id: string,
 *   supplier_name: string,
 *   agreement_title: string,
 *   reward_name?: string | null,
 *   evidence?: { reward_name?: unknown, fulfilled_at?: unknown, kind?: unknown, [key: string]: unknown } | null,
 *   fulfilled_at?: string | Date | null,
 *   amount_minor: number | string,
 *   currency: string,
 *   status: string,
 *   paid_minor?: number | null,
 *   paid_at?: string | Date | null,
 *   [key: string]: unknown,
 * }} SupplierClaimRow
 */
/** @param {SupplierClaimRow[]} rows */
export function supplierExport(rows) {
  const columns = [
    "claim_id",
    "supplier",
    "agreement",
    "reward",
    "fulfilled_at",
    "evidence_kind",
    "amount_minor",
    "currency",
    "status",
    "paid_minor",
    "paid_at",
  ];
  /** @param {unknown} value */
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    columns,
    ...rows.map((r) => [
      r.id,
      r.supplier_name,
      r.agreement_title,
      r.reward_name ?? r.evidence?.reward_name,
      r.fulfilled_at ?? r.evidence?.fulfilled_at,
      r.evidence?.kind,
      r.amount_minor,
      r.currency,
      r.status,
      r.paid_minor,
      r.paid_at instanceof Date ? r.paid_at.toISOString().slice(0, 10) : r.paid_at,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
