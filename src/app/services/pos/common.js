import {businessRegion,assertRegionAmount} from '../regional-settings.js';
import crypto from "node:crypto";
import { badRequest, forbidden, unauthorized } from "../../../utils/http-error.js";
import { normalizePhone } from "../../../utils/phone.js";
import { timingSafeEqualString } from "../../../utils/timing-safe.js";
import { isLedgerAmount, isLedgerInteger } from "../../../utils/ledger-limits.js";

export function normalizePosSale(input, business = {}) {
  if (!input || typeof input !== "object") throw badRequest("La venta debe ser un objeto JSON.");
  const saleId = input.saleId;
  const source = input.source ?? "api";
  if (typeof saleId !== "string" || !saleId.trim() || saleId.length > 200 || /[\u0000-\u001f\u007f]/u.test(saleId)) throw badRequest("Indica un identificador de venta válido (hasta 200 caracteres).");
  if (typeof source !== "string" || !/^[\p{L}\p{N} ._:-]{1,180}$/u.test(source) || !source.trim()) throw badRequest("Indica un origen válido para la venta.");
  if (typeof input.customerPhone !== "string" || !/^[+\d\s().-]+$/.test(input.customerPhone)) throw badRequest("Indica el teléfono del cliente.");
  const region = businessRegion(business);
  const customerPhone = normalizePhone(input.customerPhone,region.country);
  if (!/^\d{8,15}$/.test(customerPhone) || region.country!=="GT" && customerPhone.length<10) throw badRequest("El teléfono del cliente no es válido.");
  const amountQ = input.amountQ;
  if (!isLedgerAmount(amountQ)) throw badRequest("El monto debe ser un número no negativo con un máximo de dos decimales y no superar 99,999,999.99.");
  assertRegionAmount(amountQ,input.currency,business);
  const items = input.items ?? 0;
  if (!isLedgerInteger(items)) throw badRequest("La cantidad de artículos debe ser un entero no negativo dentro del límite permitido.");
  return { saleId: saleId.trim(), source: source.trim(), customerPhone, amountQ: Math.round(amountQ * 100) / 100, currency: region.currency, visits: 1, items };
}

export function posEventId(sale) {
  return `pos:${crypto.createHash("sha256").update(JSON.stringify([sale.source, sale.saleId])).digest("hex")}`;
}

export function verifyPosCredentials(business, { authorization = undefined, signature = undefined, rawBody = undefined, allowDisabled = false } = {}) {
  const program = business?.program_json ?? {};
  const key = program.external_awards?.api_key;
  if (typeof key !== "string" || !key || key.startsWith("enc:")) throw unauthorized("Credenciales POS inválidas.");
  let present = false;
  if (authorization !== undefined) {
    present = true;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ") || !timingSafeEqualString(authorization.slice(7), key)) throw unauthorized("Credenciales POS inválidas.");
  }
  if (signature !== undefined) {
    present = true;
    const hex = typeof signature === "string" ? signature.replace(/^sha256=/, "") : "";
    if (!/^[a-fA-F0-9]{64}$/.test(hex) || !(typeof rawBody === "string" || Buffer.isBuffer(rawBody))) throw unauthorized("Firma POS inválida.");
    const expected = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
    if (!timingSafeEqualString(hex.toLowerCase(), expected)) throw unauthorized("Firma POS inválida.");
  }
  if (!present) throw unauthorized("Envía una clave Bearer o una firma x-signature.");
  if (!allowDisabled && (program.pos_integration?.enabled !== true || program.external_awards?.enabled !== true)) throw forbidden("La conexión POS está desactivada.");
}

export function safePosIntegration(business) {
  const program = business.program_json ?? {};
  const cfg = program.pos_integration ?? {};
  const native = cfg.loyverse ?? {};
  const key = program.external_awards?.api_key;
  const hasKey = typeof key === "string" && !!key && !key.startsWith("enc:");
  return {
    region: businessRegion(business),
    enabled: cfg.enabled === true && program.external_awards?.enabled === true,
    mode: ["api", "csv", "loyverse"].includes(cfg.mode) ? cfg.mode : "api",
    automatic: cfg.automatic === true,
    has_api_key: hasKey,
    api_key_masked: hasKey ? `••••${key.slice(-4)}` : null,
    loyverse: { configured: !!native.access_token && !String(native.access_token).startsWith("enc:"), merchant_id: native.merchant_id ?? null, merchant_name: native.merchant_name ?? null, store_id: native.store_id ?? null },
    last_sync: cfg.last_sync ?? null
  };
}
