import crypto from "node:crypto";
import { GiftCardRepo } from "../repositories/gift-card-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { withTransaction } from "../database.js";
import { badRequest, forbidden } from "../../utils/http-error.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let out = "GC-";
  for (let i = 0; i < 8; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

function makeToken() {
  return `gft_${crypto.randomBytes(16).toString("hex")}`;
}

async function assertGiftCardAccess(staff, { create = false } = {}) {
  const actor = await StaffRepo.getById(staff.id);
  if (!actor || !actor.active) throw forbidden("Staff no autorizado");
  if (actor.role === "OWNER") return actor;
  if (!actor.can_manage_gift_cards) throw forbidden("No tienes permiso de gift cards");
  if (create && actor.role !== "MANAGER") throw forbidden("Solo Dueño o Gerente puede crear gift cards");
  return actor;
}

function validateMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw badRequest("Monto inválido");
  return Number(n.toFixed(2));
}

async function findExistingGiftCardTx(client, businessId, requestId) {
  if (!requestId) return null;
  const { rows } = await client.query(
    `SELECT tx.id AS transaction_id,
            tx.tx_type,
            tx.amount_q,
            tx.balance_after_q,
            tx.meta,
            gc.*
     FROM gift_card_transactions tx
     JOIN gift_cards gc ON gc.id = tx.gift_card_id
     WHERE tx.business_id = $1
       AND tx.request_id = $2
     LIMIT 1`,
    [businessId, requestId]
  );
  return rows[0] ?? null;
}

async function lockGiftCardRequest(client, businessId, requestId) {
  if (!requestId) return;
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(requestId)]
  );
}

function hydrateGiftCardSnapshot(existing) {
  const meta = existing?.meta && typeof existing.meta === "object" ? existing.meta : {};
  return {
    id: existing.id,
    business_id: existing.business_id,
    branch_id: existing.branch_id,
    code: existing.code,
    qr_token: existing.qr_token,
    issued_to_name: meta.issued_to_name ?? existing.issued_to_name ?? null,
    issued_to_phone: meta.issued_to_phone ?? existing.issued_to_phone ?? null,
    initial_amount_q: Number(meta.initial_amount_q ?? existing.initial_amount_q ?? 0),
    balance_q: Number(meta.balance_after_q ?? existing.balance_after_q ?? existing.balance_q ?? 0),
    status: String(meta.status_after ?? existing.status ?? "ACTIVE"),
    expires_at: meta.expires_at ?? existing.expires_at ?? null,
    created_by: existing.created_by ?? null,
    created_at: existing.created_at,
    updated_at: existing.updated_at
  };
}

export async function createGiftCardWithDeps(deps, {
  staff,
  amount_q,
  issued_to_name,
  issued_to_phone,
  expires_at,
  requestId = null
}) {
  const actor = await deps.assertGiftCardAccess(staff, { create: true });
  const amount = validateMoney(amount_q);

  return deps.withTransaction(async (client) => {
    await lockGiftCardRequest(client, actor.business_id, requestId);
    const existing = await findExistingGiftCardTx(client, actor.business_id, requestId);
    if (existing) {
      await AuditRepo.log({
        id: crypto.randomUUID(),
        business_id: actor.business_id,
        actor_type: "STAFF",
        actor_id: actor.id,
        action: "gift_card.issue.replay",
        ip: null,
        ua: null,
        meta: withImpersonationMeta({
          gift_card_id: existing.id,
          request_id: requestId ?? null,
          code: existing.code
        }, actor)
      }).catch(() => {});
      return hydrateGiftCardSnapshot(existing);
    }

    let card = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = crypto.randomUUID();
      const qr_token = makeToken();
      const code = makeCode();
      try {
        const { rows } = await client.query(
          `INSERT INTO gift_cards (
             id, business_id, branch_id, code, qr_token, issued_to_name, issued_to_phone,
             initial_amount_q, balance_q, status, expires_at, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            id,
            actor.business_id,
            actor.branch_id ?? null,
            code,
            qr_token,
            issued_to_name ?? null,
            issued_to_phone ?? null,
            amount,
            amount,
            "ACTIVE",
            expires_at ?? null,
            actor.id
          ]
        );
        card = rows[0];
        break;
      } catch (err) {
        if (String(err?.code) === "23505" && requestId) {
          const replay = await findExistingGiftCardTx(client, actor.business_id, requestId);
          if (replay) {
            await AuditRepo.log({
              id: crypto.randomUUID(),
              business_id: actor.business_id,
              actor_type: "STAFF",
              actor_id: actor.id,
              action: "gift_card.issue.replay",
              ip: null,
              ua: null,
              meta: withImpersonationMeta({
                gift_card_id: replay.id,
                request_id: requestId ?? null,
                code: replay.code
              }, actor)
            }).catch(() => {});
            return hydrateGiftCardSnapshot(replay);
          }
        }
        if (String(err?.code) !== "23505" || attempt === 4) throw err;
      }
    }

    if (!card) throw badRequest("No se pudo crear la gift card");

    const txId = crypto.randomUUID();
    await client.query(
      `INSERT INTO gift_card_transactions
       (id, gift_card_id, business_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        txId,
        card.id,
        actor.business_id,
        actor.id,
        requestId,
        "ISSUE",
        amount,
        amount,
        {
          issued_to_name: card.issued_to_name,
          issued_to_phone: card.issued_to_phone,
          initial_amount_q: Number(card.initial_amount_q || amount),
          balance_after_q: amount,
          status_after: "ACTIVE",
          expires_at: card.expires_at ?? null
        }
      ]
    );

    await AuditRepo.log({
      id: crypto.randomUUID(),
      business_id: actor.business_id,
      actor_type: "STAFF",
      actor_id: actor.id,
      action: "gift_card.issue",
      ip: null,
      ua: null,
      meta: withImpersonationMeta({
        gift_card_id: card.id,
        gift_card_tx_id: txId,
        request_id: requestId ?? null,
        amount_q: amount,
        code: card.code
      }, actor)
    }).catch(() => {});

    return card;
  });
}

export async function redeemGiftCardWithDeps(deps, {
  staff,
  code_or_token,
  amount_q,
  note,
  requestId = null
}) {
  const actor = await deps.assertGiftCardAccess(staff, { create: false });
  const amount = validateMoney(amount_q);

  return deps.withTransaction(async (client) => {
    await lockGiftCardRequest(client, actor.business_id, requestId);
    const existing = await findExistingGiftCardTx(client, actor.business_id, requestId);
    if (existing) {
      await AuditRepo.log({
        id: crypto.randomUUID(),
        business_id: actor.business_id,
        actor_type: "STAFF",
        actor_id: actor.id,
        action: "gift_card.redeem.replay",
        ip: null,
        ua: null,
        meta: withImpersonationMeta({
          gift_card_id: existing.id,
          request_id: requestId ?? null,
          code: existing.code
        }, actor)
      }).catch(() => {});
      return hydrateGiftCardSnapshot(existing);
    }

    const lock = await client.query(
      `SELECT * FROM gift_cards WHERE business_id = $1 AND (code = $2 OR qr_token = $2) FOR UPDATE`,
      [actor.business_id, code_or_token]
    );
    const card = lock.rows[0];
    if (!card) throw badRequest("Gift card no encontrada");
    if (card.status !== "ACTIVE") throw badRequest("Gift card no está activa");
    if (card.expires_at && new Date(card.expires_at).getTime() < Date.now()) throw badRequest("Gift card vencida");
    const current = Number(card.balance_q || 0);
    if (amount > current) throw badRequest("Saldo insuficiente en la gift card");

    const nextBalance = Number((current - amount).toFixed(2));
    const nextStatus = nextBalance <= 0 ? "EXHAUSTED" : "ACTIVE";

    await client.query(
      `UPDATE gift_cards SET balance_q = $2, status = $3, updated_at = now() WHERE id = $1`,
      [card.id, nextBalance, nextStatus]
    );
    const txId = crypto.randomUUID();
    await client.query(
      `INSERT INTO gift_card_transactions
       (id, gift_card_id, business_id, staff_user_id, request_id, tx_type, amount_q, balance_after_q, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        txId,
        card.id,
        actor.business_id,
        actor.id,
        requestId,
        "REDEEM",
        amount,
        nextBalance,
        {
          note: note ?? null,
          balance_after_q: nextBalance,
          status_after: nextStatus,
          code: card.code,
          qr_token: card.qr_token,
          initial_amount_q: Number(card.initial_amount_q || 0),
          issued_to_name: card.issued_to_name ?? null,
          issued_to_phone: card.issued_to_phone ?? null,
          expires_at: card.expires_at ?? null
        }
      ]
    );

    await AuditRepo.log({
      id: crypto.randomUUID(),
      business_id: actor.business_id,
      actor_type: "STAFF",
      actor_id: actor.id,
      action: "gift_card.redeem",
      ip: null,
      ua: null,
      meta: withImpersonationMeta({
        gift_card_id: card.id,
        gift_card_tx_id: txId,
        request_id: requestId ?? null,
        amount_q: amount,
        code: card.code
      }, actor)
    }).catch(() => {});
    return { ...card, balance_q: nextBalance, status: nextStatus };
  });
}

const giftCardDeps = {
  GiftCardRepo,
  StaffRepo,
  withTransaction,
  assertGiftCardAccess
};

export async function createGiftCard(args) {
  return createGiftCardWithDeps(giftCardDeps, args);
}

export async function redeemGiftCard(args) {
  return redeemGiftCardWithDeps(giftCardDeps, args);
}

export async function listGiftCards({ staff, limit = 100 }) {
  await assertGiftCardAccess(staff, { create: false });
  return GiftCardRepo.listByBusiness(staff.business_id, limit);
}

export async function giftCardDetails({ staff, code_or_token }) {
  await assertGiftCardAccess(staff, { create: false });
  const card = await GiftCardRepo.getByCodeOrToken(staff.business_id, code_or_token);
  if (!card) throw badRequest("Gift card no encontrada");
  const tx = await GiftCardRepo.listTxByCard(card.id, 50);
  return { card, transactions: tx };
}

export async function giftCardLedgerDetailsWithDeps(deps, { staff, code_or_token }) {
  await deps.assertGiftCardAccess(staff, { create: false });
  const card = await deps.GiftCardRepo.getByCodeOrToken(staff.business_id, code_or_token);
  if (!card) throw badRequest("Gift card no encontrada");

  const transactions = await deps.GiftCardRepo.listTxByCard(card.id, 100);
  const issueTotal = transactions
    .filter((tx) => tx.tx_type === "ISSUE")
    .reduce((sum, tx) => sum + Number(tx.amount_q || 0), 0);
  const redeemTotal = transactions
    .filter((tx) => tx.tx_type === "REDEEM")
    .reduce((sum, tx) => sum + Number(tx.amount_q || 0), 0);
  const expectedBalance = Number((issueTotal - redeemTotal).toFixed(2));
  const storedBalance = Number(Number(card.balance_q || 0).toFixed(2));
  const delta = Number((expectedBalance - storedBalance).toFixed(2));

  return {
    card,
    ledger: {
      stored_balance_q: storedBalance,
      expected_balance_q: expectedBalance,
      issue_total_q: Number(issueTotal.toFixed(2)),
      redeem_total_q: Number(redeemTotal.toFixed(2)),
      delta_q: delta,
      mismatch: Math.abs(delta) > 0.00001
    },
    transactions
  };
}

export async function giftCardLedgerDetails(args) {
  return giftCardLedgerDetailsWithDeps(giftCardDeps, args);
}
