import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  checkServiceWorkerAssets,
  javascriptReferences,
} from "../../src/scripts/build-sw-assets.mjs";
import { VERSION_PATTERN, checkAssetVersions } from "../../src/scripts/build-asset-versions.mjs";

test("generator reads runtime module references and ignores comments, types and templates", () => {
  const source = [
    '/** @typedef {import("./types.js").Shape} Shape */',
    "// import ignored from './commented-out.js';",
    "/* import ignored from './block-comment.js'; */",
    'import { api } from "/lib.js";',
    "import defaults, * as helpers from './helpers.js';",
    'export { shared } from "./shared.js";',
    "export * from './reexport.js';",
    'import "./side-effect.js";',
    "const label = \"import x from './inside-a-string.js'\";",
    "const pattern = /['\"]\\/not-a-string\\.js/;",
    "const lazy = () => import(`./lazy.js`);",
    "const dynamic = (name) => import(`./modules/${name}.js`);",
    'const worker = new URL("./worker.js", import.meta.url);',
    'link.href = "/styles/injected.css";',
    "return 1 / 2 / 3;",
  ].join("\n");
  const references = javascriptReferences(source);
  assert.deepEqual(references.explicit.sort(), [
    "./helpers.js",
    "./lazy.js",
    "./reexport.js",
    "./shared.js",
    "./side-effect.js",
    "./worker.js",
    "/lib.js",
  ]);
  assert.deepEqual(references.literals, ["/lib.js", "/styles/injected.css"]);
});

test("service worker precache block is generated and current (npm run sw:build)", () => {
  const result = checkServiceWorkerAssets();
  assert.match(result.cacheName, /^pf-[0-9a-f]{12}$/);
  assert.ok(result.assets.length > 0, "the generator must discover precache assets");
  assert.ok(
    result.assets.includes("/staff.html") && result.assets.includes("/customer.html"),
    "offline staff and customer documents must be precached",
  );
  assert.equal(
    result.fresh,
    true,
    [
      "public/sw.js is stale: its CACHE/CORE_ASSETS block differs from the generated one.",
      "Run `npm run sw:build` and commit the result.",
      ...result.summary.map((line) => `  ${line}`),
    ].join("\n"),
  );
});

test("hand-written pages and stylesheets carry content-hashed asset versions (npm run sw:build)", () => {
  const versions = checkAssetVersions();
  assert.ok(
    versions.pages.length >= 20 && versions.versioned >= 150,
    "the versioning step must cover the hand-written pages under public/",
  );
  assert.equal(
    versions.fresh,
    true,
    [
      "public/ pages or stylesheets carry stale ?v= asset versions.",
      "Run `npm run sw:build` and commit the result.",
      ...versions.summary.map((line) => `  ${line}`),
    ].join("\n"),
  );
  for (const page of versions.pages) {
    for (const match of page.source.matchAll(/(?:src|href)="\/[^"]*\?v=([^"&#]*)"/g)) {
      assert.match(match[1], VERSION_PATTERN, `${page.relativePath}: ${match[0]}`);
    }
  }
  // The precache requests exactly the versioned keys the pages and stylesheets emit.
  const worker = checkServiceWorkerAssets();
  for (const pathname of ["/styles/fonts.css", "/styles.css", "/icon.svg", "/styles/base.css"]) {
    const hash = versions.hashes.get(pathname);
    assert.ok(hash, `${pathname} must be a versioned target`);
    assert.ok(worker.assets.includes(`${pathname}?v=${hash}`), `${pathname}?v=${hash} precached`);
  }
});

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
  const fallbackEntries = Array.from(
    fallbackMatch[1].matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"\s*\]/g),
  ).map((entry) => /** @type {[string, string]} */ ([entry[1], entry[2]]));
  const fallbackMap = new Map(fallbackEntries);
  const canonicalFiles = new Map(
    Object.entries({
      "/crear-negocio/": "/admin.html",
      "/equipo/ingresar/": "/staff-login.html",
      "/equipo/escaner/": "/staff.html",
      "/mi-tarjeta/": "/customer.html",
      "/administracion/": "/admin-dashboard.html",
      "/plataforma/": "/super.html",
      "/registro/": "/join.html",
      "/ingresar/": "/ingresar.html",
    }),
  );
  assert.ok(assets.length > 0, "CORE_ASSETS should not be empty");

  for (const asset of assets) {
    if (asset === "/") continue;
    const relativePath = asset.startsWith("/") ? asset.slice(1) : asset;
    const filePath = new URL(`../../public/${relativePath}`, import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(filePath)) continue;

    const fallbackPath = canonicalFiles.get(asset) || fallbackMap.get(asset);
    assert.ok(fallbackPath, `Missing service-worker asset mapping: ${asset}`);
    const fallbackRelativePath = fallbackPath.startsWith("/")
      ? fallbackPath.slice(1)
      : fallbackPath;
    const fallbackFilePath = new URL(`../../public/${fallbackRelativePath}`, import.meta.url);
    assert.ok(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.existsSync(fallbackFilePath),
      `Missing service-worker fallback asset: ${path.basename(fallbackRelativePath)}`,
    );
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
      dependencies = Array.from(
        source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi),
        (match) => match[1],
      );
    } else {
      // JSDoc import types do not load code in the browser.
      const runtimeSource = source.replace(/\/\*[\s\S]*?\*\//g, "");
      dependencies = [
        ...Array.from(
          runtimeSource.matchAll(
            /^\s*(?:import|export)\s+(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/gm,
          ),
          (match) => match[1],
        ),
        ...Array.from(
          runtimeSource.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
          (match) => match[1],
        ),
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

  assert.deepEqual(
    [...missing].sort(),
    [],
    "Offline scripts must be precached together with their transitive imports",
  );
});
