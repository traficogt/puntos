import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("marketing landing exposes a Spanish-first demo request form", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  assert.match(html, /<form class="contact-form" id="contactForm" novalidate>/);
  assert.match(html, /label for="cfBusiness">Negocio/i);
  assert.match(html, /name="business"/);
  assert.match(html, /data-sitekey="0x4AAAAAACxpjwCi9p0pY8BF"/);
  assert.match(html, /data-language="es"/);
  assert.match(html, /Solicitar demo/);
  assert.match(html, /Activamos cada programa contigo/i);
  assert.match(html, /Para cafés, restaurantes y otros negocios/i);
  assert.doesNotMatch(html, /salones de belleza/i);
  assert.doesNotMatch(html, /Pensado para Guatemala/i);
  assert.doesNotMatch(html, /Respondemos en español/i);
  assert.doesNotMatch(html, /turnstile\/v0\/api\.js\?hl=es/);
  assert.match(source, /turnstile\/v0\/api\.js\?hl=es/);
  assert.match(source, /ensureTurnstileScript/);
});

test("marketing contact client submits demo fields and Spanish success copy", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/index.js", import.meta.url), "utf8");

  assert.match(source, /const business =/);
  assert.match(source, /business,/);
  assert.match(source, /Contexto operativo:/);
  assert.match(source, /Recibimos tu solicitud/i);
  assert.match(source, /Solicitar demo/);
});

test("contact service builds demo-request messaging for operators", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/services/contact-service.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const routes = fs.readFileSync(new URL("../../src/app/routes/public-routes.js", import.meta.url), "utf8");

  assert.match(routes, /business:\s*z\.string\(\)\.min\(1\)\.max\(160\)\.trim\(\)/);
  assert.match(source, /Solicitud de demo/i);
  assert.match(source, /Negocio/i);
});

test("marketing landing hides pricing until commercial packaging is finalized", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /Precios/i);
  assert.doesNotMatch(html, /EMPRENDEDOR/);
  assert.doesNotMatch(html, /NEGOCIO/);
  assert.doesNotMatch(html, /EMPRESA/);
  assert.doesNotMatch(html, /Q149<span>\/mes<\/span>/);
  assert.doesNotMatch(html, /Q399<span>\/mes<\/span>/);
  assert.doesNotMatch(html, /Q999<span>\/mes<\/span>/);
});
