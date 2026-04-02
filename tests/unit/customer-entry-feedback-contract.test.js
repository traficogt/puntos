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
  assert.match(html, /Si tu sesión venció, vuelve a abrir el enlace del negocio para entrar de nuevo\./);
  assert.match(html, /No hay formulario aquí\./);
  assert.match(joinHtml, /Activa o vuelve a abrir tu tarjeta/);
  assert.match(joinHtml, /Confirma tu teléfono para activar o recuperar tu tarjeta del negocio\./);
  assert.match(joinHtml, /id="joinEntryContext"/);
  assert.doesNotMatch(html, /id="joinFeedback"/);
  assert.doesNotMatch(html, /id="btnGoJoin"/);
  assert.doesNotMatch(html, /id="slug"/);
  assert.doesNotMatch(js, /setEntryFeedback\(\$, "#joinFeedback"/);
  assert.doesNotMatch(js, /btnGoJoin|joinFeedback|slugEl/);
  assert.match(joinJs, /new URLSearchParams\(location\.search\)/);
  assert.match(joinJs, /const returningSlugKey = "pf_customer_joined_slug";/);
  assert.match(joinJs, /Tu sesión anterior de .* ya venció\./);
  assert.match(joinJs, /Cerraste tu sesión de .* Solicita un nuevo código si quieres volver a entrar desde este navegador\./);
  assert.match(joinJs, /localStorage\.setItem\(returningSlugKey, slug\);/);
  assert.match(loadJs, /location\.href = `\/registro\/\$\{encodeURIComponent\(cachedSlug\)\}\?motivo=sesion-vencida`/);
});
