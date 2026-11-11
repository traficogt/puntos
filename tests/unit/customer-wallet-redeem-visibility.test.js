import test from "node:test";
import assert from "node:assert/strict";

const { getRewardViewModel, rewardsWithState } = await import("../../public/customer/rewards.js");

test("redeemable rewards are marked as available in store", () => {
  const view = getRewardViewModel(120, {
    id: "reward-1",
    name: "Café gratis",
    description: "Canjeable en caja",
    points_cost: 100
  });

  assert.equal(view.canRedeem, true);
  assert.equal(view.statusLabel, "Tienes los puntos necesarios");
  assert.equal(view.remainingPoints, 0);
});

test("sold-out and expired rewards never appear redeemable even with enough points", () => {
  const soldOut = getRewardViewModel(100, { points_cost: 10, stock: 0 });
  const expired = getRewardViewModel(100, { points_cost: 10, valid_until: "2000-01-01T00:00:00Z" });
  assert.equal(soldOut.canRedeem, false);
  assert.match(soldOut.statusLabel, /agotada/i);
  assert.equal(expired.canRedeem, false);
  assert.match(expired.statusLabel, /vencida/i);
});

test("the suggested next reward excludes unavailable rewards and handles none available", () => {
  const out = rewardsWithState(100, [{ id: "sold-out", points_cost: 1, stock: 0 }, { id: "available", points_cost: 150 }]);
  assert.equal(out.next.id, "available");
  assert.equal(out.remain, 50);
  assert.equal(rewardsWithState(100, [{ points_cost: 1, stock: 0 }]).next, null);
});

test('an affordable choice takes precedence over a more expensive future target', () => {
  const out = rewardsWithState(40, [{ id: 'future', points_cost: 100 }, { id: 'choice', points_cost: 20 }]);
  assert.equal(out.next.id, 'choice');
  assert.equal(out.remain, 0);
});

test('reward expiry is a browser refresh deadline even without inventory', async () => {
  const { nextInventoryRefresh } = await import('../../public/customer/rewards.js');
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(nextInventoryRefresh([{ points_cost: 20, valid_until: '2026-11-11T12:01:00Z' }], now), now + 60000);
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

test('manual pauses and unverified checked rewards cannot be suggested or redeemed',()=>{
 const manual=getRewardViewModel(100,{points_cost:50,available:false});assert.equal(manual.canRedeem,false);assert.match(manual.statusLabel,/temporalmente/i);
 for(const state of ['stale','unknown','unavailable']){const out=getRewardViewModel(100,{points_cost:50,inventory:{state,required:true,branches:[]}});assert.equal(out.canRedeem,false);assert.equal(out.available,false);}
});
test('branch evidence distinguishes unchecked availability and automatically ages fresh observations',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z'),base={id:'checked',points_cost:50,inventory:{state:'available',required:true,branches:[{branchId:'a',branchName:'Centro',state:'available',observedAt:'2026-11-11T11:59:00Z',freshUntil:'2026-11-11T12:04:00Z'}]}};
 const fresh=getRewardViewModel(100,base,now);assert.equal(fresh.canRedeem,true);assert.match(fresh.inventoryNote,/Centro/);assert.match(fresh.inventoryNote,/no se reservan/i);
 const old=getRewardViewModel(100,base,now+240001);assert.equal(old.canRedeem,false);assert.match(old.inventoryNote,/desactualizada/i);
 const mixed={...base,inventory:{...base.inventory,branches:[...base.inventory.branches,{branchId:'b',branchName:'Norte',state:'not_required'}]}};assert.equal(getRewardViewModel(100,mixed,now+240001).canRedeem,true);assert.match(getRewardViewModel(100,mixed,now+240001).inventoryNote,/Norte: confirma/i);
});
