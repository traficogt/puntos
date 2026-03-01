import crypto from "node:crypto";
import { GiftCardRepo } from "../repositories/gift-card-repository.js";
import { StaffRepo } from "../repositories/staff-repository.js";
import { withTransaction } from "../database.js";
import { badRequest, forbidden } from "../../utils/http-error.js";

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

export async function createGiftCard({ staff, amount_q, issued_to_name, issued_to_phone, expires_at }) {
  const actor = await assertGiftCardAccess(staff, { create: true });
  const amount = validateMoney(amount_q);
  const id = crypto.randomUUID();
  const qr_token = makeToken();
  let card = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      card = await GiftCardRepo.create({
        id,
        business_id: actor.business_id,
        branch_id: actor.branch_id,
        code: makeCode(),
        qr_token,
        issued_to_name: issued_to_name ?? null,
        issued_to_phone: issued_to_phone ?? null,
        initial_amount_q: amount,
        balance_q: amount,
        status: "ACTIVE",
        expires_at: expires_at ?? null,
        created_by: actor.id
      });
      break;
    } catch (err) {
      if (String(err?.code) !== "23505" || attempt === 4) throw err;
    }
  }
  if (!card) throw badRequest("No se pudo crear la gift card");
  await GiftCardRepo.addTx({
    id: crypto.randomUUID(),
    gift_card_id: card.id,
    business_id: actor.business_id,
    staff_user_id: actor.id,
    tx_type: "ISSUE",
    amount_q: amount,
    balance_after_q: amount,
    meta: { issued_to_name: card.issued_to_name, issued_to_phone: card.issued_to_phone }
  });
  return card;
}

export async function redeemGiftCard({ staff, code_or_token, amount_q, note }) {
  const actor = await assertGiftCardAccess(staff, { create: false });
  const amount = validateMoney(amount_q);

  return withTransaction(async (client) => {
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
    await client.query(
      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, staff_user_id, tx_type, amount_q, balance_after_q, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        crypto.randomUUID(),
        card.id,
        actor.business_id,
        actor.id,
        "REDEEM",
        amount,
        nextBalance,
        { note: note ?? null }
      ]
    );
    return { ...card, balance_q: nextBalance, status: nextStatus };
  });
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
