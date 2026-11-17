import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer rewards surface a redemption callout and in-store guidance for eligible rewards", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/customer/render.js", import.meta.url), "utf8");

  assert.match(source, /cus-rewards-callout/);
  assert.match(source, /Muestra tu QR en caja\./);
  assert.match(source, /Tienes los puntos necesarios/);
  // Missing-point badges share the singular/plural helper with every wallet message.
  assert.match(source, /missingPointsText\(remainingPoints, region\)/);
  assert.match(source, /rewardsWithState/);
});

test("customer rewards expose an explicit in-store redemption hint in the wallet shell", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");

  assert.match(html, /id="rewards"/);
  assert.match(html, /Recompensas/);
  assert.doesNotMatch(html, /Solicita un canje automático/);
});
