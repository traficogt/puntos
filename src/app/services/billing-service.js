import crypto from "node:crypto";
import { BillingRepo } from "../repositories/billing-repository.js";
import { logger } from "../../utils/logger.js";

function id() { return crypto.randomUUID(); }

/**
 * Emit a billing/usage event. Non-blocking best-effort.
 */
export async function emitBillingEvent({ businessId, eventType, amount = 1, unit = "count", metadata = {} }) {
  if (!businessId || !eventType) return;
  try {
    await BillingRepo.recordEvent({
      id: id(),
      business_id: businessId,
      event_type: eventType,
      amount,
      unit,
      metadata
    });
  } catch (err) {
    // Avoid throwing in hot paths; rely on observability metrics/logs instead.
    logger.warn({ err: err?.message || err, businessId, eventType }, "emitBillingEvent failed");
  }
}
