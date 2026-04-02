import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// eslint-disable-next-line security/detect-non-literal-fs-filename
const brandingFragment = fs.readFileSync(new URL("../../public/admin-dashboard/fragments/branding.html", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename
const programFragment = fs.readFileSync(new URL("../../public/admin-dashboard/fragments/program.html", import.meta.url), "utf8");
// eslint-disable-next-line security/detect-non-literal-fs-filename
const brandingForm = fs.readFileSync(new URL("../../public/admin-dashboard/modules/branding-form.js", import.meta.url), "utf8");

describe("owner dashboard packaging copy contract", () => {
  it("keeps branding upsell concise and operational", () => {
    assert.match(brandingFragment, /branding/i);
    assert.match(brandingFragment, /planes superiores|NEGOCIO|EMPRESA/i);
  });

  it("mentions automations as a paid capability without turning the dashboard into a pricing page", () => {
    assert.match(programFragment, /automatiz/i);
    assert.match(programFragment, /planes superiores|NEGOCIO|EMPRESA/i);
    assert.doesNotMatch(programFragment, /Q\d|USD|precio/i);
  });

  it("drives premium branding notice from the actual plan state", () => {
    assert.match(brandingForm, /state\??\.\s*planInfo\??\.\s*plan/i);
    assert.match(brandingForm, /requiredPlanLabel\??\.\s*\("rbac_matrix"\)|requiredPlanLabel\("rbac_matrix"\)/);
    assert.doesNotMatch(brandingForm, /Branding:\s\$\{/);
  });
});
