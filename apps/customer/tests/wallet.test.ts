import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGiftTransfer,
  formatQ,
  movementDetail,
  movementLabel,
  parseAmountQ,
  programCopy,
  programKind,
  programWallet,
  referralShareMessage,
  rewardState,
  tierSummary,
  transferErrorMessage,
  transferSuccessMessage,
  walletHistory,
  type Snapshot,
  type WalletMovement,
} from "../src/model.ts";
import { ApiClient, ApiError } from "../src/api.ts";
import { SessionController } from "../src/session.ts";

const base: Snapshot = {
  business: { id: "b1", name: "Café Bourbon", slug: "cafe-bourbon" },
  customer: { id: "c1", name: "Ana", phone: "+50255555555", points: 340 },
  rewards: [],
  transactions: [],
  redemptions: [],
  wallet: { providers: { apple: true, google: false }, passes: [] },
};
// Payload shapes from GET /api/mobile/customer (src/app/routes/mobile-routes.js).
const giftCard: Snapshot = {
  ...base,
  customer: { ...base.customer, points: 0 },
  cashback: null,
  program_wallet: { kind: "GIFT_CARD", balance_q: 125.5, percent: null, bonus_percent: 10 },
  wallet_history: [
    {
      id: "ledger-1",
      tx_type: "LOAD",
      amount_q: 110,
      balance_after_q: 145.5,
      created_at: "2026-11-20T15:00:00.000Z",
      base_q: 100,
      bonus_q: 10,
      note: null,
    },
    {
      id: "ledger-2",
      tx_type: "TRANSFER_OUT",
      amount_q: -20,
      balance_after_q: 125.5,
      created_at: "2026-11-24T15:00:00.000Z",
      base_q: null,
      bonus_q: null,
      note: "Feliz cumple",
    },
  ],
  tier: null,
  referral_code: { code: "ABC123" },
  referral_stats: { total_referrals: 3, completed_referrals: 2, total_points_earned: 150 },
};
const cashback: Snapshot = {
  ...base,
  cashback: { balance_q: 42.1, percent: 5 },
  program_wallet: { kind: "CASHBACK", balance_q: 42.1, percent: 5, bonus_percent: null },
  wallet_history: [],
};
const session = {
  token: "session-credential",
  expiresAt: "2099-01-01T00:00:00Z",
  customerId: "c1",
  businessId: "b1",
  slug: "cafe-bourbon",
};
const uuid = "44444444-4444-4444-8444-444444444444";
function storage() {
  const m = new Map<string, string>();
  return {
    m,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async set(key: string, value: string) {
      m.set(key, value);
    },
    async remove(key: string) {
      m.delete(key);
    },
  };
}

test("program kind follows the server payload and older payloads still read as points", () => {
  assert.equal(programKind(base), "points");
  assert.equal(programKind({ ...base, stamp_card: { stamps_required: 8, head_start: 2, filled: 3, remaining: 5, reward_label: "un café", complete: false } }), "stamp");
  assert.equal(programKind({ ...base, business: { ...base.business, member_discount: { percent_off: 10 } } }), "discount");
  assert.equal(programKind(cashback), "cashback");
  assert.equal(programKind(giftCard), "gift_card");
  // A points business whose server already sends the new keys as null.
  assert.equal(programKind({ ...base, cashback: null, program_wallet: null, wallet_history: [], tier: null }), "points");
  // Unknown future kinds never hijack the card.
  assert.equal(programKind({ ...base, program_wallet: { kind: "LOTTERY", balance_q: 9 } }), "points");
  assert.equal(programWallet({ ...base, program_wallet: { kind: "LOTTERY", balance_q: 9 } }), null);
});

test("program wallet normalizes numeric strings, clamps negatives and falls back to the cashback block", () => {
  assert.deepEqual(programWallet(giftCard), {
    kind: "GIFT_CARD",
    balance_q: 125.5,
    percent: null,
    bonus_percent: 10,
  });
  assert.deepEqual(
    programWallet({
      ...base,
      program_wallet: { kind: "CASHBACK", balance_q: "-3.25" as unknown as number, percent: "5" as unknown as number },
    }),
    { kind: "CASHBACK", balance_q: 0, percent: 5, bonus_percent: null },
  );
  assert.deepEqual(programWallet({ ...base, cashback: { balance_q: 7.333, percent: 3 } }), {
    kind: "CASHBACK",
    balance_q: 7.33,
    percent: 3,
    bonus_percent: null,
  });
  assert.equal(programWallet(base), null);
  assert.equal(programWallet(null), null);
});

test("wallet history is sorted newest first, drops malformed rows and labels movements in Spanish", () => {
  const rows = walletHistory({
    wallet_history: [
      ...giftCard.wallet_history!,
      { id: 7, tx_type: "LOAD", amount_q: 1 } as unknown as WalletMovement,
      { id: "nan", tx_type: "LOAD", amount_q: "abc", balance_after_q: 1, created_at: "x" } as unknown as WalletMovement,
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["ledger-2", "ledger-1"],
  );
  assert.equal(rows[0].note, "Feliz cumple");
  assert.equal(movementDetail(rows[0]), "Feliz cumple");
  assert.equal(movementDetail(rows[1]), "Q100.00 recargados + Q10.00 de bono");
  assert.deepEqual(walletHistory(base), []);
  assert.deepEqual(walletHistory({ wallet_history: null }), []);
  for (const [type, label] of [
    ["LOAD", "Recarga de saldo"],
    ["TRANSFER_IN", "Saldo recibido"],
    ["TRANSFER_OUT", "Saldo regalado"],
    ["SPEND", "Saldo utilizado"],
    ["EARN", "Cashback ganado"],
    ["REVERSE", "Cashback revertido"],
    ["SOMETHING_NEW", "Movimiento"],
  ])
    assert.equal(movementLabel(type), label);
  assert.equal(formatQ(1234.5), "Q1,234.50");
  assert.equal(formatQ(-20), "-Q20.00");
  assert.equal(formatQ(Number.NaN), "Q0.00");
});

test("card copy never says puntos for cashback, gift-card or discount programs", () => {
  for (const kind of ["cashback", "gift_card", "discount"] as const) {
    const copy = programCopy(kind);
    const texts = [
      copy.balanceLabel("live"),
      copy.balanceLabel("cached"),
      copy.balanceLabel("demo"),
      copy.scopeNotice,
      copy.qrPurpose,
      copy.activityEmpty,
      copy.transactionLabel(true),
      copy.transactionLabel(false),
      copy.rateLine(programWallet(cashback)) || "",
      copy.rateLine(programWallet(giftCard)) || "",
    ];
    for (const text of texts) assert.doesNotMatch(text, /punto/i, `${kind}: ${text}`);
    assert.equal(copy.rewardsHeading, null);
    assert.equal(copy.pendingNotice(5), null);
  }
  assert.equal(programCopy("cashback").rateLine(programWallet(cashback)), "Ganas 5% de cada compra como saldo.");
  assert.equal(programCopy("gift_card").rateLine(programWallet(giftCard)), "Cada recarga suma 10% extra de saldo.");
  assert.equal(programCopy("gift_card").rateLine({ kind: "GIFT_CARD", balance_q: 1, bonus_percent: 0 }), null);
  assert.equal(programCopy("cashback").balanceLabel("live"), "saldo de cashback");
  assert.equal(programCopy("gift_card").balanceLabel("cached"), "saldo guardado de tu tarjeta");
  assert.equal(programCopy("discount").balanceLabel("live"), "de descuento en cada compra");
});

test("points and stamp copy keep their units, including reward availability", () => {
  const points = programCopy("points");
  assert.equal(points.balanceLabel("live"), "puntos disponibles");
  assert.equal(points.balanceLabel("cached"), "puntos guardados");
  assert.equal(points.balanceLabel("demo"), "puntos de ejemplo");
  assert.equal(points.pendingNotice(12), "12 puntos pendientes de confirmación.");
  assert.equal(points.rewardsHeading, "Tus puntos");
  const stamp = programCopy("stamp");
  assert.equal(stamp.unit, "sellos");
  assert.equal(stamp.rewardsHeading, "Tus sellos");
  assert.equal(stamp.transactionLabel(false), "Sellos recibidos");
  assert.equal(stamp.pendingNotice(2), "2 sellos pendientes de confirmación.");
  assert.equal(
    rewardState({ id: "r", name: "Café", points_cost: 8 }, 5, false, Date.now(), "sellos").label,
    "Te faltan 3 sellos",
  );
  assert.equal(
    rewardState({ id: "r", name: "Café", points_cost: 300 }, 200, false).label,
    "Te faltan 100 puntos",
  );
});

test("tier summary reads the /mobile/customer tier block and handles the top tier", () => {
  assert.deepEqual(
    tierSummary({
      tier_level: 2,
      name: "Plata",
      points_multiplier: 1.5,
      current_points: 620,
      next_tier_name: "Oro",
      next_tier_points: 1000,
      points_to_next_tier: 380,
      perks: ["Café de cumpleaños", ""],
      color: "#C0C0C0",
    }),
    {
      name: "Plata",
      multiplierLabel: "1.5× puntos",
      progressLabel: "380 puntos más para Oro",
      progress: 0.62,
      perks: ["Café de cumpleaños"],
    },
  );
  const top = tierSummary({ name: "Oro", points_multiplier: 1, next_tier_name: null, points_to_next_tier: null });
  assert.equal(top?.multiplierLabel, null);
  assert.equal(top?.progressLabel, "Estás en el nivel más alto.");
  assert.equal(top?.progress, null);
  assert.equal(tierSummary(null), null);
  assert.equal(tierSummary({ name: "  " }), null);
});

test("referral share message carries the code and the business registration link only", () => {
  const message = referralShareMessage({ code: " abc123 ", business: "Café Bourbon", slug: "cafe-bourbon" });
  assert.equal(
    message,
    "Únete a Café Bourbon con mi código de referido ABC123. Regístrate en https://app.puntosfieles.com/registro/cafe-bourbon",
  );
  assert.throws(() => referralShareMessage({ code: "ABC123", business: "x", slug: "https://evil.example/registro/x" }));
});

test("gift transfer request matches the browser card body and keeps the caller's idempotency key", () => {
  const request = buildGiftTransfer({
    recipientPhone: " 5555-9876 ",
    amount: "20,50",
    requestId: uuid,
    available: 125.5,
  });
  assert.deepEqual(request, {
    path: "/customer/giftcard/transfer",
    method: "POST",
    body: { recipient_phone: "5555-9876", amount_q: 20.5, requestId: uuid },
  });
  assert.deepEqual(
    buildGiftTransfer({ recipientPhone: "+502 5555 9876", amount: 20, requestId: uuid, note: "  Feliz cumple " }).body,
    { recipient_phone: "+502 5555 9876", amount_q: 20, requestId: uuid, note: "Feliz cumple" },
  );
  // Retrying the same attempt sends the same key, so the server replays instead of transferring twice.
  const again = buildGiftTransfer({ recipientPhone: "5555-9876", amount: "20.50", requestId: uuid });
  assert.equal(again.body.requestId, request.body.requestId);
  assert.equal(parseAmountQ("Q 12.5"), 12.5);
  assert.equal(parseAmountQ("12,50"), 12.5);
  for (const [input, message] of [
    [{ recipientPhone: "", amount: "20", requestId: uuid }, "Ingresa el teléfono de quien recibe el saldo."],
    [{ recipientPhone: "ana@example.test", amount: "20", requestId: uuid }, "Ingresa el teléfono de quien recibe el saldo."],
    [{ recipientPhone: "55559876", amount: "", requestId: uuid }, "Ingresa un monto válido."],
    [{ recipientPhone: "55559876", amount: "0", requestId: uuid }, "Ingresa un monto mayor que cero."],
    [{ recipientPhone: "55559876", amount: "1.234", requestId: uuid }, "Usa como máximo dos decimales."],
    [{ recipientPhone: "55559876", amount: "200", requestId: uuid, available: 125.5 }, "Saldo insuficiente para regalar."],
    [{ recipientPhone: "55559876", amount: "20", requestId: "not-a-guid" }, "No se pudo preparar el regalo. Intenta de nuevo."],
  ] as const)
    assert.throws(() => buildGiftTransfer({ ...input }), { message });
});

test("transfer errors show the server's Spanish reason for client errors and the safe text otherwise", () => {
  assert.equal(
    transferErrorMessage(new ApiError(400, "Revisa los datos e intenta de nuevo.", "VALIDATION_ERROR", "Saldo insuficiente para regalar.")),
    "Saldo insuficiente para regalar.",
  );
  assert.equal(
    transferErrorMessage(new ApiError(400, "Revisa los datos e intenta de nuevo.")),
    "Revisa los datos e intenta de nuevo.",
  );
  assert.equal(
    transferErrorMessage(new ApiError(500, "No se pudo completar la solicitud. Intenta de nuevo.", "INTERNAL_ERROR", "TypeError: x is undefined")),
    "No se pudo completar la solicitud. Intenta de nuevo.",
  );
  assert.equal(transferErrorMessage(new ApiError(0, "No pudimos conectar. Revisa tu conexión e intenta de nuevo.")), "No pudimos conectar. Revisa tu conexión e intenta de nuevo.");
  assert.equal(transferErrorMessage(new Error("La cuenta cambió. Intenta de nuevo.")), "La cuenta cambió. Intenta de nuevo.");
  assert.equal(transferErrorMessage(undefined), "No se pudo regalar el saldo. Intenta de nuevo.");
  assert.equal(
    transferSuccessMessage({ recipient: { id: "r", name: "Luis" }, transferred_q: 20, balance_after_q: 105.5 }, "5555-9876"),
    "Regalaste Q20.00 a Luis. Tu nuevo saldo: Q105.50.",
  );
  assert.equal(
    transferSuccessMessage({ recipient: { id: "r", name: null }, transferred_q: 20, balance_after_q: 105.5 }, "5555-9876"),
    "Regalaste Q20.00 a 5555-9876. Tu nuevo saldo: Q105.50.",
  );
});

test("API client keeps the server's error text apart from the safe message", async () => {
  const client = new ApiClient(
    "https://app.puntosfieles.com",
    async () =>
      new Response(JSON.stringify({ error: "Saldo insuficiente para regalar.", code: "VALIDATION_ERROR" }), { status: 400 }),
  );
  await assert.rejects(
    client.request("/customer/giftcard/transfer", { method: "POST", token: "t", body: {} }),
    (e: any) =>
      e instanceof ApiError &&
      e.status === 400 &&
      e.message === "Revisa los datos e intenta de nuevo." &&
      e.detail === "Saldo insuficiente para regalar.",
  );
});

test("snapshot cache keeps balances but drops the referral code and gift notes", async () => {
  const secure = storage(),
    cache = storage();
  const c = new SessionController({ request: async () => giftCard } as any, secure, cache);
  await c.activate(session as any);
  await c.refresh();
  const raw = [...cache.m.values()].join("");
  assert.ok(raw.includes("125.5"));
  assert.ok(raw.includes("TRANSFER_OUT"));
  assert.ok(!raw.includes("ABC123"));
  assert.ok(!raw.includes("Feliz cumple"));
  assert.ok(!raw.includes("Ana"));
  assert.ok(!raw.includes("+502"));
  assert.equal(c.getState().snapshot?.referral_code?.code, "ABC123", "live state keeps it");
});
