import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/super.html");

test("super page exposes the internal magic-link generator controls", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /id="magicLinkCard"/);
  assert.match(html, /Enlaces internos/i);
  assert.match(html, /Modo de actor/i);
  assert.match(html, /Equipo/i);
  assert.match(html, /Cliente/i);
  assert.match(html, /Negocio/i);
  assert.match(html, /Actor/i);
  assert.match(html, /Destino/i);
  assert.match(html, /Generar enlace/i);
  assert.match(html, /id="magicLinkOutput"/);
  assert.match(html, /Uso interno/i);
  assert.match(html, /id="magicLinkCopy"/);
});
