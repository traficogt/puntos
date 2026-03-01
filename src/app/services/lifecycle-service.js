import crypto from "node:crypto";
import { dbQuery, withTransaction, withDbClientContext } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { sendMessage } from "./messaging-service.js";
import { TierService } from "./tier-service.js";
import { expirePointsForBusiness } from "./loyalty-ops-service.js";

function id() { return crypto.randomUUID(); }

async function recordLifecycleEvent(client, { businessId, customerId, eventType, eventDate, meta = {} }) {
  const out = await client.query(
    `INSERT INTO lifecycle_events (id, business_id, customer_id, event_type, event_date, meta)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (business_id, customer_id, event_type, event_date) DO NOTHING
     RETURNING id`,
    [id(), businessId, customerId, eventType, eventDate, meta]
  );
  return out.rowCount === 1;
}

async function awardLifecyclePoints(client, { businessId, customerId, points, eventType, meta = {} }) {
  if (!points || points <= 0) return;
  await client.query(
    `INSERT INTO transactions
     (id, business_id, customer_id, amount_q, visits, items, points, status, source, meta)
     VALUES ($1,$2,$3,0,0,0,$4,'POSTED','lifecycle',$5)`,
    [id(), businessId, customerId, points, { event_type: eventType, ...meta }]
  );
  await client.query(
    `UPDATE customer_balances
     SET points = points + $2,
         lifetime_points = lifetime_points + GREATEST($2,0),
         updated_at = now()
     WHERE customer_id = $1`,
    [customerId, points]
  );
}

async function processBirthdayBusiness(businessId, cfg) {
  if (!cfg?.birthday_enabled) return { sent: 0, awarded: 0 };
  const points = Math.max(0, Number(cfg.birthday_points ?? 0));
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await dbQuery(
    `SELECT id, name, phone
     FROM customers
     WHERE business_id = $1
       AND deleted_at IS NULL
       AND birthday IS NOT NULL
       AND to_char(birthday, 'MM-DD') = to_char(current_date, 'MM-DD')`,
    [businessId]
  );

  let sent = 0;
  let awarded = 0;
  for (const c of rows) {
    const inserted = await withTransaction(async (client) => {
      const ok = await recordLifecycleEvent(client, {
        businessId,
        customerId: c.id,
        eventType: "birthday",
        eventDate: today,
        meta: { birthday_points: points }
      });
      if (!ok) return false;
      await awardLifecyclePoints(client, {
        businessId,
        customerId: c.id,
        points,
        eventType: "birthday_bonus"
      });
      return true;
    });
    if (!inserted) continue;
    awarded += points > 0 ? 1 : 0;
    await sendMessage({
      businessId,
      customerId: c.id,
      channel: "lifecycle",
      to: c.phone,
      body: `Feliz cumpleaños${c.name ? `, ${c.name}` : ""}! ${points > 0 ? `Te regalamos ${points} puntos. ` : ""}Gracias por ser parte de nuestro programa 🎉`
    }).catch(() => { });
    sent += 1;
  }
  return { sent, awarded };
}

async function processWinbackBusiness(businessId, cfg) {
  if (!cfg?.winback_enabled) return { sent: 0, awarded: 0 };
  const days = Math.max(7, Number(cfg.winback_days ?? 30));
  const points = Math.max(0, Number(cfg.winback_points ?? 0));
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await dbQuery(
    `SELECT id, name, phone
     FROM customers
     WHERE business_id = $1
       AND deleted_at IS NULL
       AND last_visit_at IS NOT NULL
       AND last_visit_at::date = current_date - ($2 || ' days')::interval`,
    [businessId, String(days)]
  );

  let sent = 0;
  let awarded = 0;
  for (const c of rows) {
    const inserted = await withTransaction(async (client) => {
      const ok = await recordLifecycleEvent(client, {
        businessId,
        customerId: c.id,
        eventType: "winback",
        eventDate: today,
        meta: { winback_days: days, winback_points: points }
      });
      if (!ok) return false;
      await awardLifecyclePoints(client, {
        businessId,
        customerId: c.id,
        points,
        eventType: "winback_bonus"
      });
      return true;
    });
    if (!inserted) continue;
    awarded += points > 0 ? 1 : 0;
    await sendMessage({
      businessId,
      customerId: c.id,
      channel: "lifecycle",
      to: c.phone,
      body: `${c.name ? `${c.name}, ` : ""}te extrañamos. ${points > 0 ? `Tienes ${points} puntos de regreso para tu próxima visita. ` : ""}¡Vuelve pronto!`
    }).catch(() => { });
    sent += 1;
  }
  return { sent, awarded };
}

async function processSuspiciousDigestBusiness(business, cfg) {
  if (!cfg?.suspicious_digest_enabled) return { sent: false, count: 0 };
  const minCount = Math.max(1, Number(cfg.suspicious_digest_min_count ?? 1));
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await dbQuery(
    `SELECT
       t.id,
       t.created_at,
       t.points,
       t.amount_q,
       su.name AS staff_name,
       su.email AS staff_email,
       c.phone AS customer_phone
     FROM transactions t
     LEFT JOIN staff_users su ON su.id = t.staff_user_id
     LEFT JOIN customers c ON c.id = t.customer_id
     WHERE t.business_id = $1
       AND COALESCE((t.meta->'guard'->>'suspicious')::boolean, false) = true
       AND t.created_at >= now() - interval '1 day'
     ORDER BY t.created_at DESC
     LIMIT 20`,
    [business.id]
  );

  if (rows.length < minCount) return { sent: false, count: rows.length };
  if (!business.email) return { sent: false, count: rows.length, reason: "no_business_email" };

  const { rows: anyCustomer } = await dbQuery(
    `SELECT id FROM customers WHERE business_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [business.id]
  );
  if (!anyCustomer[0]) return { sent: false, count: rows.length, reason: "no_customer_for_dedupe" };

  const dedupe = await withTransaction(async (client) => {
    return recordLifecycleEvent(client, {
      businessId: business.id,
      customerId: anyCustomer[0].id,
      eventType: "suspicious_digest",
      eventDate: today,
      meta: { count: rows.length }
    });
  });
  if (!dedupe) return { sent: false, count: rows.length, reason: "already_sent_today" };

  const lines = rows.slice(0, 10).map((r) => {
    const when = new Date(r.created_at).toLocaleString();
    const who = r.staff_name || r.staff_email || "staff";
    return `${when} | ${who} | +${Number(r.points || 0)} pts | Q${Number(r.amount_q || 0).toFixed(2)} | ${r.customer_phone || "-"}`;
  });

  await sendMessage({
    businessId: business.id,
    customerId: null,
    channel: "alerts",
    to: business.email,
    body: `PuntosFieles alerta diaria\n\nSe detectaron ${rows.length} transacciones sospechosas en las ultimas 24h.\n\n${lines.join("\n")}`
  }).catch(() => { });

  return { sent: true, count: rows.length };
}

export async function runLifecycleOnce({ businessId = null } = {}) {
  const businessIds = businessId
    ? [businessId]
    : await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => BusinessRepo.listAllIds());
  const out = [];
  for (const bid of businessIds) {
    const entry = await withDbClientContext({ tenantId: bid, platformAdmin: false }, async () => {
      const business = await BusinessRepo.getById(bid);
      if (!business) return null;

      const lifecycleCfg = business.program_json?.lifecycle ?? {};
      const schedulerHour = Number(lifecycleCfg.scheduler_hour_local);
      let schedulerTz = String(lifecycleCfg.scheduler_tz || "America/Guatemala");
      try {
        Intl.DateTimeFormat("en-US", { timeZone: schedulerTz }).format(new Date());
      } catch {
        schedulerTz = "America/Guatemala";
      }
      const nowHour = Number(new Date().toLocaleString("en-US", {
        timeZone: schedulerTz,
        hour: "2-digit",
        hour12: false
      }));
      if (Number.isFinite(schedulerHour) && schedulerHour >= 0 && schedulerHour <= 23 && schedulerHour !== nowHour) {
        return { businessId: bid, skipped: true, reason: "outside_scheduled_hour", scheduler_hour_local: schedulerHour, current_hour_local: nowHour, scheduler_tz: schedulerTz };
      }

      const tierPolicy = business.program_json?.tier_policy ?? {};
      const birthday = await processBirthdayBusiness(bid, lifecycleCfg);
      const winback = await processWinbackBusiness(bid, lifecycleCfg);
      const suspiciousDigest = await processSuspiciousDigestBusiness(business, lifecycleCfg);
      const tierRetention = await TierService.runTierRetentionSweep(bid, tierPolicy).catch((e) => ({
        error: e?.message ?? String(e)
      }));
      const expiration = await expirePointsForBusiness(bid).catch((e) => ({
        error: e?.message ?? String(e)
      }));
      return { businessId: bid, birthday, winback, suspiciousDigest, tierRetention, expiration };
    });
    if (entry) out.push(entry);
  }
  return out;
}
