import test from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_TEMPLATES } from "../../src/app/routes/admin/program-support.js";

// The merchant app mirrors the server's automation templates so its "Plantillas" section can prefill
// the Automations editor without calling PUT /api/admin/automations/template (which skips the budget
// validation). The module is TypeScript; a computed specifier keeps it out of the root tsc program.
const merchantModule = new URL("../../web/merchant/src/automation-templates.ts", import.meta.url)
  .href;

test("the merchant automation templates match the server's AUTOMATION_TEMPLATES", async () => {
  const { automationTemplates } = await import(merchantModule);
  assert.deepEqual(
    automationTemplates,
    AUTOMATION_TEMPLATES.map(({ key, name, description, config }) => ({
      key,
      name,
      description,
      config,
    })),
  );
});
