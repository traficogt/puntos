import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(pathname) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL(`../../${pathname}`, import.meta.url), "utf8");
}

test("customer wallet no longer exposes export actions as a fake entitlement", () => {
  const html = read("public/customer.html");
  const js = read("public/customer/index.js");

  assert.doesNotMatch(html, /id="btnExport"/);
  assert.doesNotMatch(html, /id="btnDelete"/);
  assert.doesNotMatch(js, /\/api\/customer\/export/);
  assert.doesNotMatch(js, /\/api\/customer\/me", \{ method: "DELETE"/);
});

test("legal pages direct data requests to privacidad@puntosfieles.com", () => {
  const privacy = read("public/privacidad.html");
  const terms = read("public/terminos.html");

  assert.match(privacy, /privacidad@puntosfieles\.com/);
  assert.match(terms, /privacidad@puntosfieles\.com/);
  assert.match(privacy, /solicitar una copia de tu información personal/i);
  assert.match(terms, /acceso, corrección o eliminación/i);
});

test("customer me route exposes plan features for wallet gating and export is not plan-gated", () => {
  const route = read("src/app/routes/customer-routes.js");

  assert.match(route, /const features = planFeaturesWithOverrides\(business\.plan, overrides\)/);
  assert.match(route, /features,/);
  assert.doesNotMatch(route, /customerRoutes\.get\("\/customer\/export"[\s\S]*requirePlanFeature\("customer_export"\)/);
});
