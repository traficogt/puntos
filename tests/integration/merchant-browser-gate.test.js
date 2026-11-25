import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  capture,
  withProcessCancellation,
  hasBrowserCompletion,
} from "../../src/scripts/release-readiness-lib.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
// Each existing runner owns a synthetic HTTP fixture and closes its browser.
// Requiring its final assertion marker prevents a silent early exit from passing.
/** @type {Array<[string,string,RegExp|null]>} */
const runners = [
  ["navigation", "navigation-browser.spec.mjs", /12 navigation browser checks passed\./],
  [
    "pending import",
    "customer-migration-pending-browser.spec.mjs",
    /Migration pending responses: conversion\/evidence locked/,
  ],
  ["owner workspace", "owner-workspace-browser.spec.mjs", null],
  [
    "typed boundaries",
    "typecheck-boundaries-browser.spec.mjs",
    /PASS: accessible chart, typed region save and demo isolation/,
  ],
  [
    "launch activation",
    "launch-activation-browser.spec.mjs",
    /Launch activation:.*zero axe violations passed\./,
  ],
  ["branded QR", "branded-qr-browser.spec.mjs", /6 branded QR browser scenarios passed:/],
  [
    "first-purchase returns",
    "first-purchase-returns-browser.spec.mjs",
    /First purchase report:.*light\/dark and axe passed\./,
  ],
  // operations (wave 15b)
  ["owner operations", "owner-operations-browser.spec.mjs", /Owner operations browser:.*passed\./],
];

for (const [name, file, completion] of runners) {
  test(`merchant browser gate: ${name}`, { timeout: 115000 }, async (t) => {
    const result = await withProcessCancellation((signal) =>
      capture(process.execPath, [`web/merchant/tests/${file}`], {
        cwd,
        env: { ...process.env, NODE_ENV: "test" },
        timeoutMs: 110000,
        signal: AbortSignal.any([signal, t.signal]),
        graceMs: 500,
      }),
    );
    const detail = Buffer.concat([result.stdout, result.stderr]).toString();
    assert.equal(result.exitCode, 0, detail);
    assert.equal(result.timedOut, false, detail);
    assert.equal(result.truncated, false, detail);
    assert.equal(result.cancelled, false, detail);
    if (completion) assert.match(result.stdout.toString(), completion, detail);
    else
      assert.equal(
        hasBrowserCompletion(result.stdout.toString(), "owner-workspace-browser", 30),
        true,
        detail,
      );
  });
}
