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

test("legal pages describe the self-serve trial and card billing (draft of 2026-11-26)", () => {
  const terms = read("public/terminos.html");
  const privacy = read("public/privacidad.html");

  for (const heading of [
    "Para negocios afiliados",
    "Prueba gratis",
    "Planes, precios y facturación",
    "Cambios de plan y cancelación",
    "Reembolsos",
    "Suspensión por falta de pago",
  ])
    assert.ok(terms.includes(`<h2>${heading}</h2>`), `terms heading: ${heading}`);
  assert.match(terms, /Vigente desde el 26 de noviembre de 2026/);
  assert.match(terms, /14 días sin tarjeta/);
  assert.match(terms, /una prueba por teléfono verificado/);
  assert.match(terms, /se conservan 30 días/);
  assert.match(terms, /incluyen el IVA/);
  assert.match(terms, /quetzales/);
  assert.match(terms, /Recurrente/);
  assert.match(terms, /no recibe ni guarda los números de tarjeta/);
  assert.match(terms, /no emite factura electrónica \(FEL\)/);
  assert.match(terms, /al menos 30 días de anticipación/);
  assert.match(terms, /No hacemos reembolsos por períodos parciales/);
  assert.match(terms, /período de gracia de 7 días/);
  assert.match(terms, /soporte@puntosfieles\.com/);
  assert.doesNotMatch(terms, /garantiza/i);

  assert.ok(privacy.includes("<h2>Facturación y prueba gratis del negocio</h2>"));
  assert.match(privacy, /No emitimos factura electrónica \(FEL\) ni pedimos el NIT/);
  assert.match(privacy, /no recibe ni guarda los números de tarjeta/);
  assert.match(privacy, /normativa fiscal aplicable/);
  assert.match(privacy, /se conservan 30 días/);

  // Every section carries exactly one accessible h2 and each page keeps a single h1.
  for (const html of [terms, privacy]) {
    assert.equal((html.match(/<section>/g) || []).length, (html.match(/<h2>/g) || []).length);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
  }
});

test("customer me route exposes plan features for wallet gating and export is not plan-gated", () => {
  const route = read("src/app/routes/customer-routes.js");

  assert.match(route, /const features = planFeaturesWithOverrides\(business\.plan, overrides\)/);
  assert.match(route, /features,/);
  assert.doesNotMatch(
    route,
    /customerRoutes\.get\("\/customer\/export"[\s\S]*requirePlanFeature\("customer_export"\)/,
  );
});
