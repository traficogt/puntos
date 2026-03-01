import { churnCandidates } from "./analytics-service.js";
import { sendMessage, churnBody } from "./messaging-service.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { one } from "../repositories/base.js";
import { withDbClientContext } from "../database.js";

export async function runChurnOnce({ businessId, days }) {
  return withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
    const business = await BusinessRepo.getById(businessId);
    if (!business) return { sent: 0 };

    const candidates = await churnCandidates(businessId, days, 200);
    let sent = 0;

    for (const c of candidates) {
      // avoid repeated churn message within 30 days
      const prev = await one(
        `SELECT id FROM message_logs
         WHERE business_id=$1 AND to_addr=$2 AND channel='CHURN'
           AND created_at >= now() - interval '30 days'
         LIMIT 1`,
        [businessId, c.phone]
      );
      if (prev) continue;

      const body = churnBody({ businessName: business.name });
      const res = await sendMessage({
        businessId,
        customerId: c.id,
        channel: "CHURN",
        to: c.phone,
        body
      });
      if (res.ok) sent += 1;
    }

    return { sent };
  });
}
