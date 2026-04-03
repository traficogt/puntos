import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer return page keeps only minimal Spanish re-entry copy after removing inline pseudo-login", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinHtml = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const js = fs.readFileSync(new URL("../../public/customer/index.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const loadJs = fs.readFileSync(new URL("../../public/customer/load.js", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinJs = fs.readFileSync(new URL("../../public/join.js", import.meta.url), "utf8");

  assert.match(html, /Tu tarjeta se abre con el enlace del negocio\./);
  assert.match(html, /Si tu sesión venció, usa el acceso del negocio para entrar de nuevo\./);
  assert.match(html, /No hay formulario aquí\./);
  assert.match(joinHtml, /Activa tu tarjeta/);
  assert.match(joinHtml, /Confirma tu teléfono para activar tu tarjeta del negocio por primera vez\./);
  assert.match(joinHtml, /id="email"/);
  assert.match(joinHtml, /id="joinEntryContext"/);
  assert.doesNotMatch(html, /id="joinFeedback"/);
  assert.doesNotMatch(html, /id="btnGoJoin"/);
  assert.doesNotMatch(html, /id="slug"/);
  assert.doesNotMatch(js, /setEntryFeedback\(\$, "#joinFeedback"/);
  assert.doesNotMatch(js, /btnGoJoin|joinFeedback|slugEl/);
  assert.match(joinJs, /mode: "register"/);
  assert.match(loadJs, /location\.href = `\/ingresar\/\$\{encodeURIComponent\(cachedSlug\)\}\?motivo=sesion-vencida`/);
});
