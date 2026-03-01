import crypto from "node:crypto";
import { withTransaction, setCurrentTenant } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { computePoints } from "./points-service.js";
import { badRequest, forbidden, notFound, conflict } from "../../utils/http-error.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";

function id() { return crypto.randomUUID(); }

async function awardFromExternalEventInternal({
  businessSlug,
  apiKey,
  externalEventId,
  customerId,
  customerPhone,
  amount_q = 0,
  visits = 0,
  items = 0,
  meta = {},
  skipApiKeyCheck = false
}) {
  const publicBiz = await BusinessRepo.getPublicBySlug(businessSlug);
  if (!publicBiz) throw notFound("Business not found");
  await setCurrentTenant(String(publicBiz.id));
  const business = await BusinessRepo.getById(String(publicBiz.id));
  if (!business) throw notFound("Business not found");
  const ext = business.program_json?.external_awards ?? {};
  if (!ext.enabled) throw forbidden("External awards are disabled");
  if (!skipApiKeyCheck && (!apiKey || !timingSafeEqualString(apiKey, ext.api_key))) throw forbidden("Invalid API key");
  if (!externalEventId || String(externalEventId).length < 4) throw badRequest("externalEventId required");

  let customer = null;
  if (customerId) customer = await CustomerRepo.getById(customerId);
  if (!customer && customerPhone) customer = await CustomerRepo.getByBusinessAndPhone(business.id, customerPhone);
  if (!customer || customer.business_id !== business.id) throw notFound("Customer not found for this business");

  const points = computePoints(business, { amount_q, visits, items });
  const holdDays = Math.max(0, Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)));
  const status = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;

  return withTransaction(async (client) => {
    const dup = await client.query(
      `SELECT id FROM transactions
       WHERE business_id = $1
         AND source = 'external'
         AND meta->>'external_event_id' = $2
       LIMIT 1`,
      [business.id, String(externalEventId)]
    );
    if (dup.rowCount > 0) throw conflict("externalEventId already processed");

    const txId = id();
    await client.query(
      `INSERT INTO transactions
       (id, business_id, customer_id, amount_q, visits, items, points, status, available_at, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'external',$10)`,
      [
        txId,
        business.id,
        customer.id,
        Number(amount_q || 0),
        Math.max(0, Math.floor(Number(visits || 0))),
        Math.max(0, Math.floor(Number(items || 0))),
        points,
        status,
        availableAt,
        { ...meta, external_event_id: String(externalEventId) }
      ]
    );

    await client.query(
      `UPDATE customer_balances
       SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
           pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
           lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2,0) ELSE 0 END,
           updated_at = now()
       WHERE customer_id = $1`,
      [customer.id, points, status]
    );

    return { ok: true, transactionId: txId, customerId: customer.id, pointsAwarded: points, status, availableAt };
  });
}

export async function awardFromExternalEvent(args) {
  return awardFromExternalEventInternal({ ...args, skipApiKeyCheck: false });
}

export async function awardFromExternalEventTrusted(args) {
  return awardFromExternalEventInternal({ ...args, skipApiKeyCheck: true });
}
