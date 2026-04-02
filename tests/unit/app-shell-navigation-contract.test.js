import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("app-facing shells expose host-aware navigation markers and role-based entry copy", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customerHtml = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const joinHtml = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const staffLoginHtml = fs.readFileSync(new URL("../../public/staff-login.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const staffHtml = fs.readFileSync(new URL("../../public/staff.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const adminHtml = fs.readFileSync(new URL("../../public/admin-dashboard.html", import.meta.url), "utf8");

  for (const html of [customerHtml, joinHtml, staffLoginHtml, staffHtml, adminHtml]) {
    assert.match(html, /data-shell-link="marketing-home"/);
    assert.match(html, /href="\/sitio"/);
    assert.match(html, /<script src="\/runtime-config\.js"><\/script>/);
  }

  assert.match(staffLoginHtml, /según tu rol/i);
  assert.match(staffLoginHtml, /Escáner|panel/i);
  assert.match(adminHtml, /Centro de control/i);
  assert.match(adminHtml, /data-shell-link="app-login"/);
  assert.doesNotMatch(staffHtml, />Inicio</);
  assert.doesNotMatch(customerHtml, />Inicio</);
});
