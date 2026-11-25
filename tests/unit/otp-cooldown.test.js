import test from "node:test";
import assert from "node:assert/strict";
import { createCooldown, cooldownLabel } from "../../public/otp-cooldown.js";

test("the cooldown ticks every second and fires onDone exactly once when it expires", (t) => {
  let now = 1_000_000;
  /** @type {Array<() => void>} */
  const intervals = [];
  t.mock.method(globalThis, "setInterval", /** @type {any} */ ((fn) => (intervals.push(fn), 7)));
  const cleared = [];
  t.mock.method(globalThis, "clearInterval", /** @type {any} */ ((id) => cleared.push(id)));
  const ticks = [];
  let done = 0;
  createCooldown({
    seconds: 3,
    now: () => now,
    onTick: (left) => ticks.push(left),
    onDone: () => done++,
  });
  assert.deepEqual(ticks, [3], "the first tick runs synchronously");
  now += 1000;
  intervals[0]();
  now += 1000;
  intervals[0]();
  assert.deepEqual(ticks, [3, 2, 1]);
  assert.equal(done, 0);
  now += 1000;
  intervals[0]();
  assert.equal(done, 1);
  assert.deepEqual(cleared, [7]);
});

test("stopping the cooldown clears the interval without firing onDone; zero seconds completes at once", (t) => {
  t.mock.method(globalThis, "setInterval", /** @type {any} */ (() => 11));
  const cleared = [];
  t.mock.method(globalThis, "clearInterval", /** @type {any} */ ((id) => cleared.push(id)));
  let done = 0;
  const stop = createCooldown({ seconds: 60, onTick: () => {}, onDone: () => done++ });
  stop();
  stop();
  assert.equal(done, 0);
  assert.deepEqual(cleared, [11]);
  createCooldown({ seconds: 0, onTick: () => assert.fail("no tick"), onDone: () => done++ });
  assert.equal(done, 1);
  assert.equal(cooldownLabel(42), "Puedes reenviar en 42s");
});
