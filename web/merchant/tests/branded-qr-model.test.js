import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("browser QR settings reject weak colors and preserve tenant enrollment identity", async () => {
  assert.ok(existsSync(new URL("../src/branded-qr-model.js", import.meta.url)), "QR model exists");
  const { validateQrForeground, qrEnrollmentUrl, brandedQrPath } = await import("../src/branded-qr-model.js");
  assert.equal(validateQrForeground("#302820"), "");
  assert.equal(validateQrForeground("#204030"), "");
  for (const value of ["#FFFFFF", "#999999", "red", "#fff", "#00000000"]) assert.ok(validateQrForeground(value));
  const data = { business: { id: "own", slug: "café/x" }, registration_url: "https://app.puntosfieles.com/registro/caf%C3%A9%2Fx" };
  assert.equal(qrEnrollmentUrl(data, { business_id: "own" }), data.registration_url);
  assert.equal(qrEnrollmentUrl(data, { business_id: "other" }), "");
  for (const url of ["javascript:alert(1)", "https://example.com/registro/other", `${data.registration_url}?business_id=other`, "https://user:pass@app.puntosfieles.com/registro/caf%C3%A9%2Fx"]) {
    assert.equal(qrEnrollmentUrl({ ...data, registration_url: url }, { business_id: "own" }), "");
  }
  assert.equal(brandedQrPath("#302820"), "/api/admin/customer-enrollment/branded-qr.svg?foreground=%23302820");
});

test("demo QR is self-contained and opens only the demonstration", async () => {
  assert.ok(existsSync(new URL("../src/demo-branded-qr.js", import.meta.url)), "demo QR exists");
  const { demoBrandedQrConfiguration, demoBrandedQrSvg } = await import("../src/demo-branded-qr.js");
  const { Resvg } = await import("@resvg/resvg-js");
  const { default: jsQR } = await import("jsqr");
  const config = demoBrandedQrConfiguration();
  assert.equal(config.registration_url, "https://puntosfieles.com/demostracion#marca");
  const svg = demoBrandedQrSvg("#204030");
  assert.match(svg, /Demostración/);
  assert.equal(/(?:href|src)="https?:|<script|<foreignObject/.test(svg), false);
  const image = new Resvg(svg).render();
  assert.equal(jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height)?.data, config.registration_url);
  assert.throws(() => demoBrandedQrSvg("#FFFFFF"), /contraste/i);
});

test('source QR target is derived from an existing own source and canonical registration URL',async()=>{
  const {qrSourceEnrollmentUrl,brandedQrPath}=await import('../src/branded-qr-model.js');
  const data={business:{id:'own',slug:'one'},registration_url:'https://puntos.example/registro/one',sources:[{id:'source',business_id:'own',code:'abcdefghijklmnop',registration_url:'https://outside.test'}]};
  assert.equal(typeof qrSourceEnrollmentUrl,'function');
  assert.equal(qrSourceEnrollmentUrl(data,{business_id:'own'},'source'),'https://puntos.example/registro/one?origen=abcdefghijklmnop');
  assert.equal(qrSourceEnrollmentUrl(data,{business_id:'own'},'unknown'),'');
  assert.equal(qrSourceEnrollmentUrl(data,{business_id:'other'},'source'),'');
  assert.equal(qrSourceEnrollmentUrl({...data,sources:[{...data.sources[0],business_id:'other'}]},{business_id:'own'},'source'),'');
  assert.match(brandedQrPath('#302820','center','source'),/source_id=source$/);
});
