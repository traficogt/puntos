import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("service worker core assets are explicit and exist on disk", () => {
  // Fixed repo path for the service worker source.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  const match = source.match(/const CORE_ASSETS = \[(.*?)\];/s);
  assert.ok(match, "public/sw.js is missing CORE_ASSETS");
  const fallbackMatch = source.match(/const NAVIGATION_FALLBACKS = new Map\(\[(.*?)\]\);/s);
  assert.ok(fallbackMatch, "public/sw.js is missing NAVIGATION_FALLBACKS");

  const assets = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((entry) => entry[1]);
  /** @type {Array<[string, string]>} */
  const fallbackEntries = Array.from(fallbackMatch[1].matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"\s*\]/g))
    .map((entry) => /** @type {[string, string]} */ ([entry[1], entry[2]]));
  const fallbackMap = new Map(fallbackEntries);
  const canonicalFiles = new Map(Object.entries({ "/crear-negocio/": "/admin.html", "/equipo/ingresar/": "/staff-login.html", "/equipo/escaner/": "/staff.html", "/mi-tarjeta/": "/customer.html", "/administracion/": "/admin-dashboard.html", "/plataforma/": "/super.html", "/registro/": "/join.html", "/ingresar/": "/ingresar.html" }));
  assert.ok(assets.length > 0, "CORE_ASSETS should not be empty");

  for (const asset of assets) {
    if (asset === "/") continue;
    const relativePath = asset.startsWith("/") ? asset.slice(1) : asset;
    const filePath = new URL(`../../public/${relativePath}`, import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(filePath)) continue;

    const fallbackPath = canonicalFiles.get(asset) || fallbackMap.get(asset);
    assert.ok(fallbackPath, `Missing service-worker asset mapping: ${asset}`);
    const fallbackRelativePath = fallbackPath.startsWith("/") ? fallbackPath.slice(1) : fallbackPath;
    const fallbackFilePath = new URL(`../../public/${fallbackRelativePath}`, import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    assert.ok(fs.existsSync(fallbackFilePath), `Missing service-worker fallback asset: ${path.basename(fallbackRelativePath)}`);
  }
});


test("precache covers local script dependencies of offline pages and modules", () => {
  const publicDir = new URL("../../public/", import.meta.url);
  // Fixed repo path; dependencies are restricted to the public static tree below.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const workerSource = fs.readFileSync(new URL("sw.js", publicDir), "utf8");
  const assetList = workerSource.match(/const CORE_ASSETS = \[(.*?)\];/s);
  assert.ok(assetList, "public/sw.js is missing CORE_ASSETS");
  const assets = new Set(Array.from(assetList[1].matchAll(/"([^"]+)"/g), (entry) => entry[1]));
  const pending = [...assets].filter((asset) => /\.(?:js|html)(?:[?#]|$)/.test(asset));
  const visited = new Set();
  const missing = new Set();
  const origin = "https://offline-fixture.invalid";

  while (pending.length) {
    const asset = pending.pop();
    if (visited.has(asset)) continue;
    visited.add(asset);
    const assetUrl = new URL(asset, origin);
    const fileUrl = new URL(`.${assetUrl.pathname}`, publicDir);
    // The existing asset-existence test checks file availability separately.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const source = fs.readFileSync(fileUrl, "utf8");
    let dependencies;
    if (assetUrl.pathname.endsWith(".html")) {
      dependencies = Array.from(source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi), (match) => match[1]);
    } else {
      // JSDoc import types do not load code in the browser.
      const runtimeSource = source.replace(/\/\*[\s\S]*?\*\//g, "");
      dependencies = [
        ...Array.from(runtimeSource.matchAll(/^\s*(?:import|export)\s+(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/gm), (match) => match[1]),
        ...Array.from(runtimeSource.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g), (match) => match[1])
      ];
    }
    for (const dependency of dependencies) {
      const url = new URL(dependency, assetUrl);
      if (url.origin !== origin) continue;
      // Host-specific configuration is served dynamically, not a static asset.
      if (url.pathname === "/runtime-config.js") continue;
      const dependencyAsset = `${url.pathname}${url.search}`;
      if (!assets.has(dependencyAsset)) missing.add(`${asset} -> ${dependencyAsset}`);
      pending.push(dependencyAsset);
    }
  }

  assert.deepEqual([...missing].sort(), [], "Offline scripts must be precached together with their transitive imports");
});
