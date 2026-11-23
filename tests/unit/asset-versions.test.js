/* eslint-disable security/detect-non-literal-fs-filename -- Temporary fixture tree created by the test. */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAssetVersions,
  checkAssetVersions,
  rewriteHtml,
  versionReference,
  writeAssetVersions,
} from "../../src/scripts/build-asset-versions.mjs";

/** @param {string | Buffer} content */
const hash = (content) => crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);

let rootDir = "";
let publicDir = "";

/** @param {string} relativePath @param {string | Buffer} content */
function write(relativePath, content) {
  const file = path.join(publicDir, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** @param {string} relativePath */
const read = (relativePath) => fs.readFileSync(path.join(publicDir, relativePath), "utf8");

const INDEX_HTML = `<!doctype html>
<html lang="es">
<head>
  <!-- <link rel="stylesheet" href="/styles/app.css"> -->
  <link rel="stylesheet" href="/styles/app.css?v=1">
  <link rel="icon" href="/img/logo.png">
  <link rel="preconnect" href="/img/logo.png">
  <link rel="stylesheet" href="https://cdn.example/x.css">
  <link rel="stylesheet" href="/vendor/lib.css">
  <script src="/app.js?debug=1&v=old"></script>
  <script src="/runtime-config.js"></script>
  <script src="//cdn.example/y.js"></script>
  <script type="application/ld+json">{"image": "/img/logo.png"}</script>
  <style>body { background: url(/img/logo.png); }</style>
</head>
<body>
  <img src="/api/public/qr.svg" alt="">
  <img src="data:image/png;base64,AAAA" alt="">
  <img src="/img/logo.png" srcset="/img/logo.png 1x, /img/logo.png?v=2 2x" alt="">
  <a href="/img/logo.png">download</a>
  <img src='/img/logo.png' alt="">
  <link rel="preload" href="/pages/nested.html" as="document">
  <script type="module" src="/app.js"></script>
</body>
</html>
`;

const APP_CSS = `/* url(/fonts/a.woff2) */
@font-face { src: url(/fonts/a.woff2) format("woff2"); }
.hero { background: url("/img/logo.png?v=9"); }
.ext { background: url(https://cdn.example/bg.png); }
.data { background: url(data:image/png;base64,AAAA); }
@import "/styles/base.css";
@import url('/styles/base.css');
@import url(/styles/missing.css);
`;

before(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-versions-"));
  publicDir = path.join(rootDir, "public");
  write("index.html", INDEX_HTML);
  write(
    "pages/nested.html",
    '<link rel="stylesheet" href="../styles/app.css">\n<img src="./pic.png">\n',
  );
  write("pages/pic.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
  write("styles/app.css", APP_CSS);
  write("styles/base.css", "body { margin: 0; }\n");
  write("fonts/a.woff2", Buffer.from("font bytes"));
  write("img/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));
  write("app.js", "console.log(1);\n");
  write("sw.js", "// worker\n");
  write("vendor/lib.css", ".lib { background: url(/img/logo.png); }\n");
  write("merchant/index.html", '<link rel="stylesheet" href="/styles/app.css">\n');
  write("ayuda/index.html", '<link rel="stylesheet" href="/styles/app.css">\n');
});

after(() => {
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

test("pages and stylesheets receive content hashes, leaf first, and nothing else changes", () => {
  const result = writeAssetVersions({ rootDir });
  const logo = hash(fs.readFileSync(path.join(publicDir, "img/logo.png")));
  const font = hash("font bytes");
  const base = hash("body { margin: 0; }\n");
  const js = hash("console.log(1);\n");
  const pic = hash(fs.readFileSync(path.join(publicDir, "pages/pic.png")));
  const vendor = hash(".lib { background: url(/img/logo.png); }\n");

  const expectedCss = `/* url(/fonts/a.woff2) */
@font-face { src: url(/fonts/a.woff2?v=${font}) format("woff2"); }
.hero { background: url("/img/logo.png?v=${logo}"); }
.ext { background: url(https://cdn.example/bg.png); }
.data { background: url(data:image/png;base64,AAAA); }
@import "/styles/base.css?v=${base}";
@import url('/styles/base.css?v=${base}');
@import url(/styles/missing.css);
`;
  assert.equal(read("styles/app.css"), expectedCss);
  const app = hash(expectedCss);

  assert.equal(
    read("index.html"),
    `<!doctype html>
<html lang="es">
<head>
  <!-- <link rel="stylesheet" href="/styles/app.css"> -->
  <link rel="stylesheet" href="/styles/app.css?v=${app}">
  <link rel="icon" href="/img/logo.png?v=${logo}">
  <link rel="preconnect" href="/img/logo.png">
  <link rel="stylesheet" href="https://cdn.example/x.css">
  <link rel="stylesheet" href="/vendor/lib.css?v=${vendor}">
  <script src="/app.js?debug=1&v=${js}"></script>
  <script src="/runtime-config.js"></script>
  <script src="//cdn.example/y.js"></script>
  <script type="application/ld+json">{"image": "/img/logo.png"}</script>
  <style>body { background: url(/img/logo.png); }</style>
</head>
<body>
  <img src="/api/public/qr.svg" alt="">
  <img src="data:image/png;base64,AAAA" alt="">
  <img src="/img/logo.png?v=${logo}" srcset="/img/logo.png?v=${logo} 1x, /img/logo.png?v=${logo} 2x" alt="">
  <a href="/img/logo.png">download</a>
  <img src='/img/logo.png?v=${logo}' alt="">
  <link rel="preload" href="/pages/nested.html" as="document">
  <script type="module" src="/app.js?v=${js}"></script>
</body>
</html>
`,
  );
  assert.equal(
    read("pages/nested.html"),
    `<link rel="stylesheet" href="../styles/app.css?v=${app}">\n<img src="./pic.png?v=${pic}">\n`,
  );

  // Generated trees and vendored stylesheets are listed nowhere and left as they were.
  assert.equal(read("merchant/index.html"), '<link rel="stylesheet" href="/styles/app.css">\n');
  assert.equal(read("ayuda/index.html"), '<link rel="stylesheet" href="/styles/app.css">\n');
  assert.equal(read("vendor/lib.css"), ".lib { background: url(/img/logo.png); }\n");
  assert.deepEqual(
    result.pages.map((entry) => entry.relativePath),
    ["public/index.html", "public/pages/nested.html"],
  );
  assert.deepEqual(
    result.stylesheets.map((entry) => entry.relativePath),
    ["public/styles/app.css", "public/styles/base.css"],
  );
  // index.html: 9 (app.css, icon, vendor, 2 scripts, img src, 2 srcset candidates, quoted img);
  // nested.html: 2; app.css: font, image and two @import targets.
  assert.equal(result.versioned, 9 + 2 + 4);
  assert.deepEqual(result.cycles, []);
  const index = result.pages.find((entry) => entry.relativePath === "public/index.html");
  assert.deepEqual(index?.unresolved, ["/runtime-config.js"]);
  assert.equal(result.hashes.get("/styles/app.css"), app);
});

test("a second run is a no-op and a changed leaf cascades through its stylesheet", () => {
  const before_ = Object.fromEntries(
    ["index.html", "pages/nested.html", "styles/app.css", "styles/base.css"].map((file) => [
      file,
      read(file),
    ]),
  );
  const check = checkAssetVersions({ rootDir });
  assert.equal(check.fresh, true, check.summary.join("\n"));
  assert.deepEqual(check.stale, []);
  writeAssetVersions({ rootDir });
  for (const [file, content] of Object.entries(before_)) assert.equal(read(file), content, file);

  write("img/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 3]));
  const stale = checkAssetVersions({ rootDir });
  assert.equal(stale.fresh, false);
  assert.deepEqual(
    stale.stale.map((entry) => entry.relativePath),
    ["public/styles/app.css", "public/index.html", "public/pages/nested.html"],
  );
  assert.match(stale.summary[0], /^public\/styles\/app\.css \(4 references\)$/);
  writeAssetVersions({ rootDir });
  assert.equal(checkAssetVersions({ rootDir }).fresh, true);
  assert.notEqual(read("styles/app.css"), before_["styles/app.css"]);
  assert.equal(read("styles/base.css"), before_["styles/base.css"]);
});

test("versionReference keeps external, API, document and unknown targets as written", () => {
  const hashFor = (pathname) => (pathname === "/a.css" ? "0123abcd" : "");
  assert.equal(
    versionReference("https://cdn.example/a.css", "/", hashFor),
    "https://cdn.example/a.css",
  );
  assert.equal(versionReference("//cdn.example/a.css", "/", hashFor), "//cdn.example/a.css");
  assert.equal(versionReference("mailto:x@example.com", "/", hashFor), "mailto:x@example.com");
  assert.equal(versionReference("#top", "/", hashFor), "#top");
  assert.equal(versionReference("/api/a.css", "/", hashFor), "/api/a.css");
  assert.equal(versionReference("/page.html", "/", hashFor), "/page.html");
  assert.equal(versionReference("/sw.js", "/", hashFor), "/sw.js");
  assert.equal(versionReference("/missing.css", "/", hashFor), "/missing.css");
  assert.equal(versionReference("/a.css", "/", hashFor), "/a.css?v=0123abcd");
  assert.equal(
    versionReference("a.css?v=1#x", "/dir/", () => "0123abcd"),
    "a.css?v=0123abcd#x",
  );
  assert.equal(versionReference("/a.css?x=1&v=2&y=3", "/", hashFor), "/a.css?x=1&y=3&v=0123abcd");
  assert.equal(versionReference(" /a.css ", "/", hashFor), " /a.css?v=0123abcd ");
  const html = rewriteHtml('<IMG SRC="/a.css"><LINK REL="Stylesheet" HREF="/a.css">', "/", hashFor);
  assert.equal(
    html.source,
    '<IMG SRC="/a.css?v=0123abcd"><LINK REL="Stylesheet" HREF="/a.css?v=0123abcd">',
  );
  assert.equal(html.versioned, 2);
});

test("buildAssetVersions never writes", () => {
  const original = read("index.html");
  write("img/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 4]));
  const result = buildAssetVersions({ rootDir });
  assert.equal(result.fresh, false);
  assert.equal(read("index.html"), original);
});
