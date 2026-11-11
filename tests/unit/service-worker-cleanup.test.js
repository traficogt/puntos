import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("service worker uses network-first updates for app code and pages", () => {
  // Fixed repo paths for the service worker runtime and shared registration helper.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const swSource = fs.readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const libSource = fs.readFileSync(new URL("../../public/lib.js", import.meta.url), "utf8");

  assert.match(swSource, /const CACHE = "pf-v\d+"/);
  assert.match(swSource, /NETWORK_FIRST_DESTINATIONS/);
  assert.match(swSource, /event\.request\.mode === "navigate"/);
  assert.match(swSource, /networkFirst\(event\.request/);
  assert.match(swSource, /addEventListener\("fetch"/);
  assert.match(swSource, /pathname\.length > 1 && pathname\.endsWith\("\/"\)/);
  assert.match(swSource, /normalizedPath/);
  assert.doesNotMatch(swSource, /registration\.unregister\(\)/);

  assert.match(libSource, /registerServiceWorker/);
  assert.match(libSource, /params\.get\("sw"\) === "off"/);
  assert.match(libSource, /updateViaCache: "none"/);
  assert.match(libSource, /controllerchange/);
  assert.match(libSource, /SKIP_WAITING/);
});

test('first service-worker activation preserves the page, subsequent upgrade refreshes once', async t => {
  const { registerServiceWorker } = await import('../../public/lib.js');
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  let reloads = 0;
  let onControl = () => {};
  const serviceWorker = { controller: null, addEventListener(_name, fn) { onControl = fn; }, async register() { return { update: async () => {}, addEventListener() {}, waiting: null }; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { search: '', reload() { reloads++; } } });
  t.after(() => {
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (priorLocation) Object.defineProperty(globalThis, 'location', priorLocation); else Reflect.deleteProperty(globalThis, 'location');
  });
  await registerServiceWorker();
  onControl();
  assert.equal(reloads, 0, 'installing offline support must not discard a first-visit form');
  onControl(); onControl();
  assert.equal(reloads, 1);
});
