import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { fmtDT, formatNumber, formatPoints, missingPointsText } from "../../public/customer/format.js";
import { getRewardViewModel, rewardProgressText } from "../../public/customer/rewards.js";
import { buildWalletEngagement } from "../../src/app/services/native-wallet/engagement.js";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture URL.
const renderSource = await fs.readFile(new URL("../../public/customer/render.js", import.meta.url), "utf8");
const { renderHistory, renderRewards, renderTier } = await import(data(renderSource
  .replace('"/lib.js"', JSON.stringify(data("export const setHidden=(el,hidden)=>{if(el)el.hidden=hidden;};")))
  .replace('"./rewards.js"', JSON.stringify(new URL("../../public/customer/rewards.js", import.meta.url).href))
  .replace('"./format.js"', JSON.stringify(new URL("../../public/customer/format.js", import.meta.url).href))));

function element(tag = "div") {
  let text = "";
  return {
    tagName: tag, children: [], hidden: false, className: "", value: 0, dataset: {}, isConnected: true,
    get textContent() { return text + this.children.map(child => child.textContent).join(" "); },
    set textContent(value) { text = String(value); this.children = []; },
    get firstChild() { return this.children[0] || null; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { text = ""; this.children = children; },
    classList: { add() {}, remove() {}, toggle() {} }
  };
}

function setup(t, region = undefined) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  if (region) Object.assign($("#main").dataset, region);
  for (const [key, value] of Object.entries({ document: { createElement: element }, window: { setTimeout: () => 1, clearTimeout() {} } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  return { $, text: selector => $(selector).textContent };
}

test("customer numbers use the business region instead of generic Spanish", () => {
  assert.equal(formatNumber(12345), "12,345");
  assert.equal(formatNumber(0.1), "0.1");
  assert.equal(formatNumber(12345, { locale: "es-CL" }), "12.345");
  assert.equal(formatPoints(1), "1 punto");
  assert.equal(formatPoints(12345), "12,345 puntos");
  assert.equal(missingPointsText(1), "Te falta 1 punto");
  assert.equal(missingPointsText(2), "Te faltan 2 puntos");
  assert.match(fmtDT("2026-11-16T18:30:00Z"), /16\/11\/2026/);
  assert.match(fmtDT("2026-11-16T18:30:00Z"), /12:30/);
});

test("reward status and progress copy agree in number and use the regional format", () => {
  assert.equal(getRewardViewModel(99, { points_cost: 100 }).statusLabel, "Te falta 1 punto para canjear");
  assert.equal(getRewardViewModel(0, { points_cost: 12000 }).statusLabel, "Te faltan 12,000 puntos para canjear");
  assert.equal(rewardProgressText(1000, { name: "Pastel", points_cost: 5000 }), "Ya tienes 1,000 de 5,000 puntos para “Pastel”.");
  assert.equal(rewardProgressText(4999, { name: "Pastel", points_cost: 5000 }), "Te falta 1 punto para “Pastel”.");
  assert.equal(rewardProgressText(2500, { name: "Pastel", points_cost: 5000 }, { locale: "es-CL" }), "Te faltan 2.500 puntos para “Pastel”.");
});

test("reward cards pluralize choices and missing points with one rule", t => {
  const h = setup(t);
  const choices = [{ id: "a", name: "Café", points_cost: 1500 }, { id: "b", name: "Pan", points_cost: 1501 }, { id: "c", name: "Té", points_cost: 100 }];
  renderRewards(h.$, 1500, choices, { region: { locale: "es-GT" } });
  const cards = h.text("#rewards");
  assert.match(cards, /Tus puntos alcanzan para 2 opciones/);
  assert.doesNotMatch(cards, /opciónes/);
  assert.match(cards, /Costo: 1,500 puntos/);
  assert.match(cards, /Te falta 1 punto(?!s)/);
  assert.doesNotMatch(cards, /Te faltan 1 puntos/);
  renderRewards(h.$, 100, [choices[2]], {});
  assert.match(h.text("#rewards"), /Tus puntos alcanzan para 1 opción(?!es)/);
  renderRewards(h.$, 1, [{ id: "x", name: "Galleta", points_cost: 1, active: true }], { progress: { available_points: 1, pending_points: 0, reward: { id: "x", name: "Galleta", points_cost: 1, remaining_points: 0 }, choices: [{ id: "x", name: "Galleta", points_cost: 1, active: true }] } });
  assert.equal(h.text("#nextRewardBalance"), "1 punto disponible · 1 punto de costo");
});

test("tier progress never shows negative points or claims a false top tier", t => {
  const h = setup(t);
  renderTier(h.$, { name: "Bronce", points_to_next_tier: -300, next_tier_name: "Plata", current_points: 800, next_tier_points: 500 });
  assert.equal(h.text("#tierProgress"), "Ya tienes los puntos para Plata; tu nivel se actualizará pronto.");
  assert.equal(h.$("#tierProgressBar").value, 100);
  renderTier(h.$, { name: "Bronce", points_to_next_tier: 0, next_tier_name: "Plata", current_points: 500, next_tier_points: 500 });
  assert.equal(h.text("#tierProgress"), "Ya tienes los puntos para Plata; tu nivel se actualizará pronto.");
  renderTier(h.$, { name: "Bronce", points_to_next_tier: null, next_tier_name: "Plata", current_points: 100, next_tier_points: 500 });
  assert.equal(h.text("#tierProgress"), "Siguiente nivel: Plata.");
  assert.doesNotMatch(h.text("#tierProgress"), /máximo/);
  renderTier(h.$, { name: "Plata", points_to_next_tier: 1, next_tier_name: "Oro", current_points: 1199, next_tier_points: 1200 });
  assert.equal(h.text("#tierProgress"), "1 punto más para Oro");
  renderTier(h.$, { name: "Plata", points_to_next_tier: "1200", next_tier_name: "Oro", current_points: 0, next_tier_points: 1200 });
  assert.equal(h.text("#tierProgress"), "1,200 puntos más para Oro");
  assert.equal(h.$("#tierProgressBar").value, 0);
  renderTier(h.$, { name: "Diamante", points_to_next_tier: null, next_tier_name: null });
  assert.equal(h.text("#tierProgress"), "¡Nivel máximo alcanzado! 🎉");
  assert.equal(h.$("#tierProgressBar").value, 100);
});

test("tier perks are replaced on a same-card refresh and follow the card region", t => {
  const h = setup(t, { locale: "es-CL" });
  renderTier(h.$, { name: "Oro", points_multiplier: "1.50", perks: ["Café gratis"], next_tier_name: null });
  assert.match(h.text("#tierPerks"), /Café gratis/);
  // The award engine never applies points_multiplier: the card must not promise it.
  assert.equal(h.text("#tierMultiplier"), "Por puntos ganados");
  assert.doesNotMatch(h.text("#tierMultiplier"), /\d\s*x/i);
  renderTier(h.$, { name: "Plata", points_multiplier: 1, points_to_next_tier: 2500, next_tier_name: "Oro" });
  assert.equal(h.text("#tierPerks"), "");
  assert.equal(h.text("#tierProgress"), "2.500 puntos más para Oro");
});

test("activity history shows point values in the regional format with number agreement", t => {
  const h = setup(t);
  const base = { created_at: "2026-11-16T12:00:00Z", provenance: { kind: "purchase", status: "POSTED" } };
  renderHistory(h.$, [{ ...base, points_delta: 12345 }, { ...base, points_delta: -1, provenance: { kind: "redemption", status: "POSTED" } }],
    [{ created_at: base.created_at, reward_name: "Pastel", points_cost: 12000, status: "REDEEMED", code: "ABC" }], { locale: "es-GT", timezone: "America/Guatemala", currency: "GTQ" });
  assert.match(h.text("#tx"), /· \+12,345 puntos/);
  assert.match(h.text("#tx"), /· -1 punto(?!s)/);
  assert.doesNotMatch(h.text("#tx"), /12345|pts/);
  assert.match(h.text("#red"), /Costo registrado: 12,000 puntos · Código: ABC/);
});

test("native wallet engagement copy uses the business locale and Spanish number agreement", () => {
  const base = { points: 99, program_type: "SPEND", program_json: { points_per_q: 0.1 }, wallet_branches: [], snapshot_at: "2026-11-11T12:00:00Z" };
  const reward = { id: "r", name: "Café", points_cost: 100, active: true, available: true, branch_ids: [] };
  const close = buildWalletEngagement({ ...base, wallet_rewards: [reward] });
  assert.equal(close.progress, "Te falta 1 punto para Café.");
  assert.match(close.earning, /^0\.1 puntos por GTQ 1\./);
  const far = buildWalletEngagement({ ...base, points: 0, wallet_rewards: [{ ...reward, points_cost: 12345 }] });
  assert.equal(far.progress, "Te faltan 12,345 puntos para Café.");
  const visit = buildWalletEngagement({ ...base, program_type: "VISIT", program_json: { points_per_visit: 1 }, wallet_rewards: [{ ...reward, points_cost: 1 }] });
  assert.equal(visit.progress, "Puedes elegir Café por 1 punto.");
  assert.equal(visit.earning, "1 punto por visita.");
  const chile = buildWalletEngagement({ ...base, points: 0, program_json: { points_per_q: 0.5, region: { country: "CL", currency: "CLP", timezone: "America/Santiago" } }, wallet_rewards: [{ ...reward, points_cost: 2500 }] });
  assert.equal(chile.progress, "Te faltan 2.500 puntos para Café.");
  assert.match(chile.earning, /^0,5 puntos por CLP 1\./);
});
