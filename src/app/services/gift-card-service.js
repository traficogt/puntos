import { assertRegionAmount, businessRegion } from "./regional-settings.js";
import crypto from "node:crypto";
import { GiftCardRepo } from "../repositories/gift-card-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { withTransaction } from "../database.js";
import { badRequest, conflict, forbidden } from "../../utils/http-error.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import {
  compare,
  fromMinor,
  isPositive,
  isZero,
  sub,
  sum,
  toMinor,
  toNumber,
} from "../../utils/money.js";
import { errorCode } from "../../utils/error-shape.js";

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
  if (create && actor.role !== "MANAGER")
    throw forbidden("Solo Dueño o Gerente puede crear gift cards");
  return actor;
}

// Client-supplied amount: must be a positive finite number. Returned as the
// number the regional decimal-scale check expects; the ledger math below works
// on integer centavos (toMinor) once that check has passed.
function validateMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw badRequest("Monto inválido");
  return n;
}

async function validateRegionalMoney(client, businessId, amount) {
  const { rows } = await client.query("SELECT program_json FROM businesses WHERE id=$1 FOR SHARE", [
    businessId,
  ]);
  const business = rows[0];
  if (!business) throw badRequest("Negocio no encontrado");
  const region = businessRegion(business);
  assertRegionAmount(amount, region.currency, business);
  return region;
}

async function findExistingGiftCardTx(client, businessId, requestId, opts = {}) {
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
    [businessId, requestId],
  );
  const existing = rows[0] ?? null;
  if (!existing) return null;
  // An idempotency replay must be the SAME logical operation. A requestId reused
  // for a different operation type, or for a different card, is a client error —
  // not a silent no-op that returns the wrong card's snapshot without acting.
  if (opts.expectType && existing.tx_type !== opts.expectType) {
    throw conflict("requestId ya fue usado para otra operación de gift card");
  }
  if (opts.cardToken && existing.code !== opts.cardToken && existing.qr_token !== opts.cardToken) {
    throw conflict("requestId ya fue usado para otra gift card");
  }
  return existing;
}

async function lockGiftCardRequest(client, businessId, requestId) {
  if (!requestId) return;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    String(businessId),
    String(requestId),
  ]);
}

function hydrateGiftCardSnapshot(existing) {
  const meta = existing?.meta && typeof existing.meta === "object" ? existing.meta : {};
  return {
    currency: meta.currency || "GTQ",
    id: existing.id,
    business_id: existing.business_id,
    branch_id: existing.branch_id,
    code: existing.code,
    qr_token: existing.qr_token,
    issued_to_name: meta.issued_to_name ?? existing.issued_to_name ?? null,
    issued_to_phone: meta.issued_to_phone ?? existing.issued_to_phone ?? null,
    initial_amount_q: toNumber(toMinor(meta.initial_amount_q ?? existing.initial_amount_q ?? 0)),
    balance_q: toNumber(
      toMinor(meta.balance_after_q ?? existing.balance_after_q ?? existing.balance_q ?? 0),
    ),
    status: String(meta.status_after ?? existing.status ?? "ACTIVE"),
    expires_at: meta.expires_at ?? existing.expires_at ?? null,
    created_by: existing.created_by ?? null,
    created_at: existing.created_at,
    updated_at: existing.updated_at,
  };
}

export async function createGiftCardWithDeps(
  deps,
  { staff, amount_q, issued_to_name, issued_to_phone, expires_at, requestId = null },
) {
  const auditRepo = deps.AuditRepo ?? AuditRepo;
  const actor = await deps.assertGiftCardAccess(staff, { create: true });
  const amount = validateMoney(amount_q);

  return deps.withTransaction(async (client) => {
    await lockGiftCardRequest(client, actor.business_id, requestId);
    const existing = await findExistingGiftCardTx(client, actor.business_id, requestId, {
      expectType: "ISSUE",
    });
    if (existing) {
      await auditRepo
        .log({
          id: crypto.randomUUID(),
          business_id: actor.business_id,
          actor_type: "STAFF",
          actor_id: actor.id,
          action: "gift_card.issue.replay",
          ip: null,
          ua: null,
          meta: withImpersonationMeta(
            {
              gift_card_id: existing.id,
              request_id: requestId ?? null,
              code: existing.code,
            },
            actor,
          ),
        })
        .catch(() => {});
      return hydrateGiftCardSnapshot(existing);
    }

    const region = await validateRegionalMoney(client, actor.business_id, amount);
    const amountMinor = toMinor(amount);
    /** @type {Record<string, any> | null} */
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
            fromMinor(amountMinor),
            fromMinor(amountMinor),
            "ACTIVE",
            expires_at ?? null,
            actor.id,
          ],
        );
        card = rows[0];
        break;
      } catch (err) {
        if (String(errorCode(err)) === "23505" && requestId) {
          const replay = await findExistingGiftCardTx(client, actor.business_id, requestId, {
            expectType: "ISSUE",
          });
          if (replay) {
            await auditRepo
              .log({
                id: crypto.randomUUID(),
                business_id: actor.business_id,
                actor_type: "STAFF",
                actor_id: actor.id,
                action: "gift_card.issue.replay",
                ip: null,
                ua: null,
                meta: withImpersonationMeta(
                  {
                    gift_card_id: replay.id,
                    request_id: requestId ?? null,
                    code: replay.code,
                  },
                  actor,
                ),
              })
              .catch(() => {});
            return hydrateGiftCardSnapshot(replay);
          }
        }
        if (String(errorCode(err)) !== "23505" || attempt === 4) throw err;
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
        fromMinor(amountMinor),
        fromMinor(amountMinor),
        {
          currency: region.currency,
          issued_to_name: card.issued_to_name,
          issued_to_phone: card.issued_to_phone,
          initial_amount_q: toNumber(
            card.initial_amount_q == null ? amountMinor : toMinor(card.initial_amount_q),
          ),
          balance_after_q: toNumber(amountMinor),
          status_after: "ACTIVE",
          expires_at: card.expires_at ?? null,
        },
      ],
    );

    await auditRepo
      .log({
        id: crypto.randomUUID(),
        business_id: actor.business_id,
        actor_type: "STAFF",
        actor_id: actor.id,
        action: "gift_card.issue",
        ip: null,
        ua: null,
        meta: withImpersonationMeta(
          {
            gift_card_id: card.id,
            gift_card_tx_id: txId,
            request_id: requestId ?? null,
            amount_q: toNumber(amountMinor),
            currency: region.currency,
            code: card.code,
          },
          actor,
        ),
      })
      .catch(() => {});

    return { ...card, currency: region.currency };
  });
}

export async function redeemGiftCardWithDeps(
  deps,
  { staff, code_or_token, amount_q, note, requestId = null },
) {
  const auditRepo = deps.AuditRepo ?? AuditRepo;
  const actor = await deps.assertGiftCardAccess(staff, { create: false });
  const amount = validateMoney(amount_q);

  return deps.withTransaction(async (client) => {
    await lockGiftCardRequest(client, actor.business_id, requestId);
    const existing = await findExistingGiftCardTx(client, actor.business_id, requestId, {
      expectType: "REDEEM",
      cardToken: code_or_token,
    });
    if (existing) {
      await auditRepo
        .log({
          id: crypto.randomUUID(),
          business_id: actor.business_id,
          actor_type: "STAFF",
          actor_id: actor.id,
          action: "gift_card.redeem.replay",
          ip: null,
          ua: null,
          meta: withImpersonationMeta(
            {
              gift_card_id: existing.id,
              request_id: requestId ?? null,
              code: existing.code,
            },
            actor,
          ),
        })
        .catch(() => {});
      return hydrateGiftCardSnapshot(existing);
    }

    const region = await validateRegionalMoney(client, actor.business_id, amount);
    const amountMinor = toMinor(amount);
    const lock = await client.query(
      `SELECT * FROM gift_cards WHERE business_id = $1 AND (code = $2 OR qr_token = $2) FOR UPDATE`,
      [actor.business_id, code_or_token],
    );
    const card = lock.rows[0];
    if (!card) throw badRequest("Gift card no encontrada");
    if (card.status !== "ACTIVE") throw badRequest("Gift card no está activa");
    if (card.expires_at && new Date(card.expires_at).getTime() < Date.now())
      throw badRequest("Gift card vencida");
    // Exact centavo arithmetic on the NUMERIC string pg returns for balance_q.
    const current = toMinor(card.balance_q);
    if (compare(amountMinor, current) > 0) throw badRequest("Saldo insuficiente en la gift card");

    const nextBalance = sub(current, amountMinor);
    const nextStatus = isPositive(nextBalance) ? "ACTIVE" : "EXHAUSTED";

    await client.query(
      `UPDATE gift_cards SET balance_q = $2, status = $3, updated_at = now() WHERE id = $1`,
      [card.id, fromMinor(nextBalance), nextStatus],
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
        fromMinor(amountMinor),
        fromMinor(nextBalance),
        {
          currency: region.currency,
          note: note ?? null,
          balance_after_q: toNumber(nextBalance),
          status_after: nextStatus,
          code: card.code,
          qr_token: card.qr_token,
          initial_amount_q: toNumber(toMinor(card.initial_amount_q)),
          issued_to_name: card.issued_to_name ?? null,
          issued_to_phone: card.issued_to_phone ?? null,
          expires_at: card.expires_at ?? null,
        },
      ],
    );

    await auditRepo
      .log({
        id: crypto.randomUUID(),
        business_id: actor.business_id,
        actor_type: "STAFF",
        actor_id: actor.id,
        action: "gift_card.redeem",
        ip: null,
        ua: null,
        meta: withImpersonationMeta(
          {
            gift_card_id: card.id,
            gift_card_tx_id: txId,
            request_id: requestId ?? null,
            amount_q: toNumber(amountMinor),
            currency: region.currency,
            code: card.code,
          },
          actor,
        ),
      })
      .catch(() => {});
    return {
      ...card,
      balance_q: toNumber(nextBalance),
      status: nextStatus,
      currency: region.currency,
    };
  });
}

const giftCardDeps = {
  GiftCardRepo,
  StaffRepo,
  withTransaction,
  assertGiftCardAccess,
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
  // Exact centavo sums over the NUMERIC strings pg returns; a mismatch is any
  // non-zero delta rather than a float comparison with a tolerance.
  const issueTotal = sum(
    transactions.filter((tx) => tx.tx_type === "ISSUE").map((tx) => toMinor(tx.amount_q)),
  );
  const redeemTotal = sum(
    transactions.filter((tx) => tx.tx_type === "REDEEM").map((tx) => toMinor(tx.amount_q)),
  );
  const expectedBalance = sub(issueTotal, redeemTotal);
  const storedBalance = toMinor(card.balance_q);
  const delta = sub(expectedBalance, storedBalance);

  return {
    card,
    ledger: {
      stored_balance_q: toNumber(storedBalance),
      expected_balance_q: toNumber(expectedBalance),
      issue_total_q: toNumber(issueTotal),
      redeem_total_q: toNumber(redeemTotal),
      delta_q: toNumber(delta),
      mismatch: !isZero(delta),
    },
    transactions,
  };
}

export async function giftCardLedgerDetails(args) {
  return giftCardLedgerDetailsWithDeps(giftCardDeps, args);
}
