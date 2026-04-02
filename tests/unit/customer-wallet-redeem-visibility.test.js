import test from "node:test";
import assert from "node:assert/strict";

const { getRewardViewModel } = await import("../../public/customer/rewards.js");

test("redeemable rewards are marked as available in store", () => {
  const view = getRewardViewModel(120, {
    id: "reward-1",
    name: "Café gratis",
    description: "Canjeable en caja",
    points_cost: 100
  });

  assert.equal(view.canRedeem, true);
  assert.equal(view.statusLabel, "Disponible para canje en caja");
  assert.equal(view.remainingPoints, 0);
});

test("locked rewards explain how many points are missing", () => {
  const view = getRewardViewModel(40, {
    id: "reward-2",
    name: "Postre gratis",
    description: "Canjeable en caja",
    points_cost: 75
  });

  assert.equal(view.canRedeem, false);
  assert.equal(view.remainingPoints, 35);
  assert.match(view.statusLabel, /Te faltan 35 puntos/);
});
