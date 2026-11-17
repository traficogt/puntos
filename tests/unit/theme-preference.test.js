import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("theme bootstrap honors saved preference before system preference", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/theme.js", import.meta.url), "utf8");

  assert.match(source, /localStorage\.getItem\("pf-theme"\)/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /dataset\.theme/);
  assert.match(source, /theme-color/);
  assert.match(source, /aria-label/);
  assert.match(source, /title/);
});

test("an OS light/dark change re-applies the theme without doubling the toggle's click handler", async () => {
  const { bootTheme } = await import("../../public/theme.js");
  const listeners = [];
  const attributes = {};
  const glyph = { textContent: "" };
  const toggle = {
    addEventListener: (name, handler) => { if (name === "click") listeners.push(handler); },
    querySelector: () => glyph,
    setAttribute: (name, value) => { attributes[name] = value; }
  };
  const doc = {
    readyState: "complete",
    documentElement: { dataset: {} },
    querySelector: () => null,
    getElementById: id => id === "themeToggle" ? toggle : null,
    addEventListener() {}
  };
  const stored = new Map();
  let onSystemChange = event => { throw new Error(`No media listener for ${event}`); };
  const win = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    matchMedia: () => ({ matches: false, addEventListener: (_name, handler) => { onSystemChange = handler; } })
  };
  bootTheme(/** @type {any} */ (doc), /** @type {any} */ (win));
  assert.equal(doc.documentElement.dataset.theme, "light");
  onSystemChange({ matches: true });
  onSystemChange({ matches: false });
  onSystemChange({ matches: true });
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.equal(attributes["aria-label"], "Cambiar a tema claro");
  assert.equal(listeners.length, 1);
  for (const handler of listeners) handler();
  // One click flips the theme exactly once.
  assert.equal(doc.documentElement.dataset.theme, "light");
  assert.equal(stored.get("pf-theme"), "light");
  assert.equal(attributes["aria-pressed"], "true");
});
