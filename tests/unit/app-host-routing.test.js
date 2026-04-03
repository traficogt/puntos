import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAppRoutePath,
  normalizeHostHeader,
  resolveHostSplitRedirect,
  runtimeConfigForHost
} from "../../src/utils/app-host-routing.js";

test("normalizeHostHeader strips ports and casing", () => {
  assert.equal(normalizeHostHeader("App.LocalHost:3001"), "app.localhost");
  assert.equal(normalizeHostHeader("puntosfieles.com"), "puntosfieles.com");
});

test("app route detection covers shared product paths", () => {
  assert.equal(isAppRoutePath("/staff/login"), true);
  assert.equal(isAppRoutePath("/staff"), true);
  assert.equal(isAppRoutePath("/registro/cafe-bourbon"), true);
  assert.equal(isAppRoutePath("/ingresar/cafe-bourbon"), true);
  assert.equal(isAppRoutePath("/join/cafe-bourbon"), true);
  assert.equal(isAppRoutePath("/c"), true);
  assert.equal(isAppRoutePath("/admin-dashboard"), true);
  assert.equal(isAppRoutePath("/"), false);
});

test("marketing host redirects product routes to app origin", () => {
  const redirect = resolveHostSplitRedirect({
    host: "localhost:3001",
    path: "/staff/login",
    originalUrl: "/staff/login?next=%2Fstaff",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(redirect, "http://app.localhost:3001/staff/login?next=%2Fstaff");
});

test("live marketing host infers app origin when configured origins are still local defaults", () => {
  const redirect = resolveHostSplitRedirect({
    host: "puntosfieles.com",
    path: "/staff/login",
    originalUrl: "/staff/login",
    forwardedProto: "https",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(redirect, "https://app.puntosfieles.com/staff/login");
});

test("app host sends root traffic into the app shell", () => {
  const redirect = resolveHostSplitRedirect({
    host: "app.localhost:3001",
    path: "/",
    originalUrl: "/",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(redirect, "http://app.localhost:3001/staff/login");
});

test("live app host infers its own shell when configured origins are still local defaults", () => {
  const redirect = resolveHostSplitRedirect({
    host: "app.puntosfieles.com",
    path: "/",
    originalUrl: "/",
    forwardedProto: "https",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(redirect, "https://app.puntosfieles.com/staff/login");
});

test("runtime config points app pages at the app origin and marketing pages at marketing origin", () => {
  assert.deepEqual(
    runtimeConfigForHost({
      host: "app.localhost:3001",
      appOrigin: "http://app.localhost:3001",
      marketingOrigin: "http://localhost:3001"
    }),
    {
      apiBaseUrl: "",
      publicWebOrigin: "http://app.localhost:3001",
      appOrigin: "http://app.localhost:3001",
      marketingOrigin: "http://localhost:3001",
      shell: "web-app"
    }
  );

  assert.deepEqual(
    runtimeConfigForHost({
      host: "localhost:3001",
      appOrigin: "http://app.localhost:3001",
      marketingOrigin: "http://localhost:3001"
    }),
    {
      apiBaseUrl: "",
      publicWebOrigin: "http://localhost:3001",
      appOrigin: "http://app.localhost:3001",
      marketingOrigin: "http://localhost:3001",
      shell: "web-marketing"
    }
  );
});

test("runtime config infers live app and marketing origins from the incoming host when config is local-only", () => {
  assert.deepEqual(
    runtimeConfigForHost({
      host: "app.puntosfieles.com",
      forwardedProto: "https",
      appOrigin: "http://app.localhost:3001",
      marketingOrigin: "http://localhost:3001"
    }),
    {
      apiBaseUrl: "",
      publicWebOrigin: "https://app.puntosfieles.com",
      appOrigin: "https://app.puntosfieles.com",
      marketingOrigin: "https://puntosfieles.com",
      shell: "web-app"
    }
  );
});
