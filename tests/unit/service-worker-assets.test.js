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
  const fallbackEntries = Array.from(fallbackMatch[1].matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"\s*\]/g))
    .map((entry) => [entry[1], entry[2]]);
  const fallbackMap = new Map(fallbackEntries);
  assert.ok(assets.length > 0, "CORE_ASSETS should not be empty");

  for (const asset of assets) {
    if (asset === "/") continue;
    const relativePath = asset.startsWith("/") ? asset.slice(1) : asset;
    const filePath = new URL(`../../public/${relativePath}`, import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(filePath)) continue;

    const fallbackPath = fallbackMap.get(asset);
    assert.ok(fallbackPath, `Missing service-worker asset mapping: ${asset}`);
    const fallbackRelativePath = fallbackPath.startsWith("/") ? fallbackPath.slice(1) : fallbackPath;
    const fallbackFilePath = new URL(`../../public/${fallbackRelativePath}`, import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    assert.ok(fs.existsSync(fallbackFilePath), `Missing service-worker fallback asset: ${path.basename(fallbackRelativePath)}`);
  }
});
