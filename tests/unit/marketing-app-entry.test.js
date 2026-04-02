import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { resolveHostSplitRedirect } from "../../src/utils/app-host-routing.js";

test("marketing landing stays isolated from app entry and keeps onboarding off the public path", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const admin = fs.readFileSync(new URL("../../public/admin.html", import.meta.url), "utf8");

  assert.match(html, /Solicitar demo/);
  assert.match(html, /href="#contacto"/);
  assert.doesNotMatch(html, /Ingreso del equipo/);
  assert.doesNotMatch(html, /href="\/staff\/login"/);
  assert.doesNotMatch(html, /href="\/admin"/);

  assert.match(admin, /Uso interno/);
  assert.match(admin, /operación interna/i);
});

test("marketing host sends customer registration and team routes to the app origin", () => {
  const registroRedirect = resolveHostSplitRedirect({
    host: "localhost:3001",
    path: "/registro/cafe-bourbon",
    originalUrl: "/registro/cafe-bourbon",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  const staffRedirect = resolveHostSplitRedirect({
    host: "localhost:3001",
    path: "/staff/login",
    originalUrl: "/staff/login",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(registroRedirect, "http://app.localhost:3001/registro/cafe-bourbon");
  assert.equal(staffRedirect, "http://app.localhost:3001/staff/login");
});
