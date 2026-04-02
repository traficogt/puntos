import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// eslint-disable-next-line security/detect-non-literal-fs-filename
const superJs = fs.readFileSync(new URL("../../public/super/index.js", import.meta.url), "utf8");

describe("super plan packaging contract", () => {
  it("describes NEGOCIO as the practical target tier", () => {
    assert.match(superJs, /NEGOCIO/i);
    assert.match(superJs, /NEGOCIO[\s\S]{0,400}analítica[\s\S]{0,400}niveles[\s\S]{0,400}referidos[\s\S]{0,400}gift cards[\s\S]{0,400}automatizaciones/i);
  });

  it("keeps EMPRESA focused on strategic capabilities", () => {
    assert.match(superJs, /EMPRESA/i);
    assert.match(superJs, /EMPRESA[\s\S]{0,400}gamificaci[óo]n[\s\S]{0,400}(external awards|integraci[óo]n externa)[\s\S]{0,400}branding[\s\S]{0,400}QR/i);
  });
});
