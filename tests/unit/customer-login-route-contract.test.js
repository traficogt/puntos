import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer login has its own ingresar page and script", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/ingresar.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/ingresar.js", import.meta.url), "utf8");

  assert.match(html, /Ingresa a tu tarjeta/);
  assert.match(html, /WhatsApp o correo/);
  assert.match(html, /id="email"/);
  assert.match(js, /mode: "login"/);
});
