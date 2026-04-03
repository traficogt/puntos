import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer-facing routes use /registro while preserving temporary compatibility for /join", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinHtml = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const loginHtml = fs.readFileSync(new URL("../../public/ingresar.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerHtml = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerJs = fs.readFileSync(new URL("../../public/customer/index.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerLoadJs = fs.readFileSync(new URL("../../public/customer/load.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinJs = fs.readFileSync(new URL("../../public/join.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const loginJs = fs.readFileSync(new URL("../../public/ingresar.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const adminJs = fs.readFileSync(new URL("../../public/admin.js", import.meta.url), "utf8");

  assert.match(customerHtml, /\/ingresar\/&lt;slug&gt;/);
  assert.match(customerLoadJs, /location\.href = `\/ingresar\/\$\{encodeURIComponent\(cachedSlug\)\}\?motivo=sesion-vencida`/);
  assert.match(customerJs, /location\.href = `\/ingresar\/\$\{encodeURIComponent\(cachedSlug\)\}\?motivo=salida`/);
  assert.match(joinJs, /mode: "register"/);
  assert.match(loginJs, /mode: "login"/);
  assert.match(adminJs, /\/registro\//);
  assert.match(joinHtml, /Activa tu tarjeta/);
  assert.match(loginHtml, /Ingresa a tu tarjeta/);
  assert.match(loginHtml, /Todavía no tengo tarjeta/);
});
