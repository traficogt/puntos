#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename -- Reads only repository files under public/ and src/, and writes only public/sw.js. */
/**
 * Service worker precache generator.
 *
 *   npm run sw:build   refresh the ?v= asset versions of the hand-written pages, then
 *                      rewrite the generated block in public/sw.js
 *   npm run sw:check   exit 1 when a page carries stale versions or public/sw.js is stale
 *   node src/scripts/build-sw-assets.mjs --report   print the asset list and the
 *                                                   difference against the shipped block
 *
 * The generated block (between the BEGIN/END GENERATED markers in public/sw.js)
 * holds `const CACHE` and `const CORE_ASSETS`. Everything outside the markers is
 * preserved byte for byte.
 *
 * Discovery starts from the application documents the worker serves offline:
 *   - NAVIGATION_FALLBACKS in public/sw.js (request aliases and their documents)
 *   - the canonical Spanish document routes in src/middleware/spanish-web.js
 *   - the sendFile document routes in src/app/server.js
 *   (the browser route aliases in src/utils/spanish-web-routes.js resolve an alias
 *   request to its document)
 * Each document is parsed for local <script src>, <link href> (stylesheets, icons,
 * manifest, preloads), <img>/<source> sources and inline scripts. JavaScript is
 * walked through static imports, `import("literal")`, `new URL("literal",
 * import.meta.url)` and worker constructors; root-absolute string literals that
 * name an existing file under public/ (for example a stylesheet injected at
 * runtime or a fetched HTML fragment) are followed as well. CSS contributes
 * `@import` targets and `url()` references (fonts, images); the web manifest
 * contributes its icons.
 *
 * Asset versions come first: src/scripts/build-asset-versions.mjs rewrites `?v=<content
 * hash>` on the local references of every hand-written page and stylesheet, and this
 * generator keeps query strings exactly as the pages request them, so the precache keys
 * and the pages always agree. `npm run sw:check` verifies both outputs.
 *
 * The cache name is `pf-` plus twelve hex digits of a SHA-256 over the sorted
 * asset keys and the bytes of every precached file, so it changes exactly when a
 * precached file changes. Bump CACHE_EPOCH to force a rotation without an asset
 * change (for example to purge runtime-cached responses from older workers).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINK_RELS, checkAssetVersions, writeAssetVersions } from "./build-asset-versions.mjs";

const SCRIPT_PATH = fs.realpathSync(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");

export const BEGIN_MARKER = "// BEGIN GENERATED (npm run sw:build)";
export const END_MARKER = "// END GENERATED (npm run sw:build)";
const CACHE_PREFIX = "pf-";
/** Manual rotation knob: changing this string changes CACHE even if no asset changed. */
const CACHE_EPOCH = "2026-11-23";

/**
 * Assets requested at runtime that no static reference reveals (for example a
 * URL assembled from variables and passed to fetch()). Entries are request paths
 * relative to the site root, optionally with a query string. A trailing
 * `/*.ext` expands to every file with that extension in that directory, so a
 * module folder can be covered without listing each file.
 * @type {string[]}
 */
export const EXTRA_ASSETS = [];

const ORIGIN = "https://sw-assets.invalid";

/**
 * Paths the worker never serves from the precache. Keep this in step with the
 * early returns of the fetch handler in public/sw.js.
 * @type {RegExp[]}
 */
const EXCLUDED_PATH_PATTERNS = [
  /^\/api(?:\/|$)/i,
  /^\/guias(?:\/|$)/i,
  /^\/sitemap\.xml$/i,
  /^\/(?:revision-ilustraciones|revision-editorial|revision-astryx)(?:\/|$)/i,
  /^\/preferencias-de-mensajes(?:\/|$)/i,
  /^\/marketing-preferences\.html$/i,
  /^\/(?:merchant|negocio|demostracion)(?:\/|$)/i,
  /^\/(?:app-preview|vista-previa-app)(?:\/|$)/i,
  /^\/ayuda(?:\/|$)/i,
  /^\/pwa-test(?:\/|$)/i,
  /^\/runtime-config\.js$/i,
  /^\/sw\.js$/i,
];

const SKIPPED_SCHEMES = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const ASSET_LITERAL =
  /^\/(?!\/)[\w@.-]+(?:\/[\w@.-]+)*\.(?:css|html|js|mjs|json|webmanifest|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf)(?:\?[\w=&%.-]*)?$/;
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** @param {string} value @param {string} other */
function compare(value, other) {
  return value < other ? -1 : value > other ? 1 : 0;
}

/** @param {string} pathname */
function isExcluded(pathname) {
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** @param {string} file */
function readText(file) {
  return fs.readFileSync(file, "utf8");
}

/**
 * @param {string} source
 * @param {RegExp} pattern
 * @param {string} description
 */
function requireMatch(source, pattern, description) {
  const match = source.match(pattern);
  if (!match) throw new Error(`build-sw-assets: could not find ${description}`);
  return match;
}

/** @param {string} swSource */
export function parseNavigationFallbacks(swSource) {
  const block = requireMatch(
    swSource,
    /const NAVIGATION_FALLBACKS = new Map\(\[(.*?)\]\);/s,
    "NAVIGATION_FALLBACKS in public/sw.js",
  )[1];
  return new Map(
    Array.from(block.matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"\s*\]/g), (entry) => [
      entry[1],
      entry[2],
    ]),
  );
}

/** @param {string} middlewareSource */
export function parseSpanishDocuments(middlewareSource) {
  const block = requireMatch(
    middlewareSource,
    /const documents = \{(.*?)\};/s,
    "the documents map in src/middleware/spanish-web.js",
  )[1];
  return new Map(
    Array.from(block.matchAll(/"([^"]+)":\s*"([^"]+)"/g), (entry) => [entry[1], `/${entry[2]}`]),
  );
}

/** @param {string} routesSource */
export function parseSpanishAliases(routesSource) {
  const block = requireMatch(
    routesSource,
    /const browserRoutes = \[(.*?)\n\];/s,
    "browserRoutes in src/utils/spanish-web-routes.js",
  )[1];
  return new Map(
    Array.from(block.matchAll(/\[\s*"([^"]+)",\s*\[([^\]]*)\]\s*\]/g), (entry) => [
      entry[1],
      Array.from(entry[2].matchAll(/"([^"]+)"/g), (alias) => alias[1]),
    ]),
  );
}

/** @param {string} serverSource */
export function parseServerDocumentRoutes(serverSource) {
  const routes = new Map(
    Array.from(
      serverSource.matchAll(
        /app\.get\(\s*"([^"]+)"[^;]*?sendFile\(\s*path\.join\(\s*publicDir,\s*"([^"]+)"\s*\)/g,
      ),
      (entry) => [entry[1], `/${entry[2]}`],
    ),
  );
  if (!routes.size) throw new Error("build-sw-assets: no sendFile routes found in server.js");
  return routes;
}

/**
 * Comment-free JavaScript with every string and template literal replaced by a
 * numbered placeholder, plus the literal values themselves.
 * @param {string} source
 * @returns {{ code: string, literals: Array<{ value: string, dynamic: boolean }> }}
 */
export function tokenizeJavaScript(source) {
  /** @type {Array<{ value: string, dynamic: boolean }>} */
  const literals = [];
  const n = source.length;
  let code = "";
  let i = 0;

  /** @param {string} value @param {boolean} dynamic */
  const placeholder = (value, dynamic) => {
    literals.push({ value, dynamic });
    return `\u0000${literals.length - 1}\u0000`;
  };

  /** @param {number} start @param {string} quote */
  function quotedEnd(start, quote) {
    let j = start + 1;
    while (j < n) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === quote || ch === "\n") break;
      j++;
    }
    return j;
  }

  /** @param {number} start index after `${` @returns {number} index after the closing brace */
  function expressionEnd(start) {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      const ch = source[j];
      const next = source[j + 1];
      if (ch === "'" || ch === '"') {
        j = quotedEnd(j, ch) + 1;
        continue;
      }
      if (ch === "`") {
        j = templateAt(j).end;
        continue;
      }
      if (ch === "/" && next === "/") {
        const end = source.indexOf("\n", j);
        j = end < 0 ? n : end;
        continue;
      }
      if (ch === "/" && next === "*") {
        const end = source.indexOf("*/", j + 2);
        j = end < 0 ? n : end + 2;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    return j;
  }

  /** @param {number} start index of the opening backtick */
  function templateAt(start) {
    let j = start + 1;
    let value = "";
    let dynamic = false;
    while (j < n) {
      const ch = source[j];
      if (ch === "\\") {
        value += ch + (source[j + 1] ?? "");
        j += 2;
        continue;
      }
      if (ch === "`") break;
      if (ch === "$" && source[j + 1] === "{") {
        dynamic = true;
        value += "${}";
        j = expressionEnd(j + 2);
        continue;
      }
      value += ch;
      j++;
    }
    return { end: j + 1, value, dynamic };
  }

  /** @param {number} start index of the opening slash */
  function regexEnd(start) {
    let j = start + 1;
    let inClass = false;
    while (j < n) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") return start + 1;
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) break;
      j++;
    }
    j++;
    while (j < n && /[a-z]/i.test(source[j])) j++;
    return j;
  }

  function regexAllowed() {
    const trimmed = code.replace(/\s+$/, "");
    if (!trimmed) return true;
    const word = trimmed.match(/[A-Za-z_$][\w$]*$/);
    if (word) return REGEX_KEYWORDS.has(word[0]);
    return !/[\w$)\]}\u0000]$/.test(trimmed);
  }

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? n : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      code += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = quotedEnd(i, ch);
      code += placeholder(source.slice(i + 1, end), false);
      i = end + 1;
      continue;
    }
    if (ch === "`") {
      const template = templateAt(i);
      code += placeholder(template.value, template.dynamic);
      i = template.end;
      continue;
    }
    if (ch === "/" && regexAllowed()) {
      i = regexEnd(i);
      code += " 0 ";
      continue;
    }
    code += ch;
    i++;
  }
  return { code, literals };
}

const STATIC_IMPORT =
  /\b(?:import|export)\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+|\*|[\w$]+)?(?:\s*,\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+))?\s*(?:from\s*)?\u0000(\d+)\u0000/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*\u0000(\d+)\u0000\s*[,)]/g;
const MODULE_URL = /\bnew\s+URL\s*\(\s*\u0000(\d+)\u0000\s*,\s*import\.meta\.url\s*\)/g;
const WORKER_URL = /\bnew\s+(?:Shared)?Worker\s*\(\s*\u0000(\d+)\u0000/g;

/**
 * Local references made by a JavaScript module.
 * @param {string} source
 * @returns {{ explicit: string[], literals: string[] }}
 */
export function javascriptReferences(source) {
  const { code, literals } = tokenizeJavaScript(source);
  /** @type {string[]} */
  const explicit = [];
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT, MODULE_URL, WORKER_URL]) {
    for (const match of code.matchAll(pattern)) {
      const literal = literals[Number(match[1])];
      if (literal && !literal.dynamic) explicit.push(literal.value);
    }
  }
  const candidates = literals
    .filter((literal) => !literal.dynamic && ASSET_LITERAL.test(literal.value))
    .map((literal) => literal.value);
  return { explicit, literals: candidates };
}

/**
 * Local references made by an HTML document: asset tags plus inline scripts.
 * @param {string} source
 * @returns {{ explicit: string[], literals: string[] }}
 */
export function htmlReferences(source) {
  const html = source.replace(/<!--[\s\S]*?-->/g, "");
  /** @type {string[]} */
  const explicit = [];
  /** @type {string[]} */
  const literals = [];
  for (const tag of html.matchAll(/<(script|link|img|source|video|audio)\b([^>]*)>/gi)) {
    const name = tag[1].toLowerCase();
    /** @type {Record<string, string>} */
    const attributes = {};
    for (const attribute of tag[2].matchAll(
      /([A-Za-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
    )) {
      attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
    }
    if (name === "script" || name === "img" || name === "source" || name === "video") {
      if (attributes.src) explicit.push(attributes.src);
    }
    if (name === "audio" && attributes.src) explicit.push(attributes.src);
    if (name === "video" && attributes.poster) explicit.push(attributes.poster);
    if ((name === "img" || name === "source") && attributes.srcset) {
      for (const candidate of attributes.srcset.split(",")) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) explicit.push(url);
      }
    }
    if (name === "link" && attributes.href) {
      const rels = (attributes.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
      if (rels.some((rel) => LINK_RELS.has(rel)) || LINK_RELS.has(rels.join(" "))) {
        explicit.push(attributes.href);
      }
    }
  }
  for (const inline of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(inline[1])) continue;
    const references = javascriptReferences(inline[2]);
    explicit.push(...references.explicit);
    literals.push(...references.literals);
  }
  return { explicit, literals };
}

/**
 * `@import` targets and `url()` references of a stylesheet.
 * @param {string} source
 */
export function cssReferences(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {string[]} */
  const explicit = [];
  for (const match of css.matchAll(
    /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)|"([^"]*)"|'([^']*)')/gi,
  )) {
    explicit.push((match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim());
  }
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi)) {
    explicit.push((match[1] ?? match[2] ?? match[3] ?? "").trim());
  }
  return { explicit: explicit.filter(Boolean), literals: /** @type {string[]} */ ([]) };
}

/**
 * Icon sources of a web app manifest.
 * @param {string} source
 */
export function manifestReferences(source) {
  const manifest = JSON.parse(source);
  /** @type {string[]} */
  const explicit = [];
  /** @param {unknown} icons the manifest's icons/screenshots list, when it is one */
  const collect = (icons) => {
    for (const icon of Array.isArray(icons) ? icons : []) {
      if (icon && typeof icon.src === "string") explicit.push(icon.src);
    }
  };
  collect(manifest.icons);
  collect(manifest.screenshots);
  for (const shortcut of Array.isArray(manifest.shortcuts) ? manifest.shortcuts : []) {
    collect(shortcut?.icons);
  }
  return { explicit, literals: /** @type {string[]} */ ([]) };
}

/**
 * @typedef {object} BuildOptions
 * @property {string} [rootDir] Repository root (defaults to the checkout containing this script).
 */

/**
 * @typedef {object} BuildResult
 * @property {string} swPath
 * @property {string} cacheName
 * @property {string[]} assets Precache request keys in generated order.
 * @property {string} currentSource public/sw.js as it is on disk.
 * @property {string} source public/sw.js with the generated block refreshed.
 * @property {Map<string, string>} entries Request path -> document file (relative to public/).
 */

/**
 * Compute the precache list and the content-hashed cache name.
 * @param {BuildOptions} [options]
 * @returns {BuildResult}
 */
export function buildServiceWorkerAssets(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const publicDir = path.join(rootDir, "public");
  const swPath = path.join(publicDir, "sw.js");
  const currentSource = readText(swPath);

  const fallbacks = parseNavigationFallbacks(currentSource);
  const documents = parseSpanishDocuments(
    readText(path.join(rootDir, "src", "middleware", "spanish-web.js")),
  );
  const aliases = parseSpanishAliases(
    readText(path.join(rootDir, "src", "utils", "spanish-web-routes.js")),
  );
  const serverRoutes = parseServerDocumentRoutes(
    readText(path.join(rootDir, "src", "app", "server.js")),
  );

  /** @param {string} pathname */
  const fileFor = (pathname) => {
    const file = path.join(publicDir, decodeURIComponent(pathname));
    const relative = path.relative(publicDir, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return "";
    }
    return stat.isFile() ? file : "";
  };

  /** @param {string} pathname */
  const canonicalOf = (pathname) =>
    pathname.length > 1 && pathname.endsWith("/") ? pathname : `${pathname}/`;

  /**
   * Resolve a navigation request path to the document file that answers it.
   * @param {string} requestPath
   * @param {Set<string>} [seen]
   * @returns {string} document path relative to the site root, or "" when unknown
   */
  function documentFor(requestPath, seen = new Set()) {
    if (seen.has(requestPath)) return "";
    seen.add(requestPath);
    if (fileFor(requestPath)) return requestPath;
    const normalized =
      requestPath.length > 1 && requestPath.endsWith("/") ? requestPath.slice(0, -1) : requestPath;
    if (fallbacks.has(normalized)) {
      const target = fallbacks.get(normalized) || "";
      if (target && target !== requestPath) {
        const resolved = documentFor(target, seen);
        if (resolved) return resolved;
      }
    }
    const canonical = canonicalOf(requestPath);
    if (documents.has(canonical)) return documents.get(canonical) || "";
    if (serverRoutes.has(requestPath)) return serverRoutes.get(requestPath) || "";
    for (const [route, routeAliases] of aliases) {
      if (routeAliases.includes(requestPath) && documents.has(route)) {
        return documents.get(route) || "";
      }
    }
    return "";
  }

  /** @type {Map<string, string>} */
  const entries = new Map();
  /** @param {string} requestPath */
  const addEntry = (requestPath) => {
    if (isExcluded(requestPath) || entries.has(requestPath)) return;
    const document = documentFor(requestPath);
    if (!document) {
      throw new Error(`build-sw-assets: cannot resolve the document for "${requestPath}"`);
    }
    entries.set(requestPath, document);
  };
  for (const [request, target] of fallbacks) {
    // Canonical paths without their trailing slash are normalized by the worker.
    if (`${request}/` !== target) addEntry(request);
    addEntry(target);
  }
  // Legacy aliases from spanish-web-routes.js (for example /customer) only become
  // entries when NAVIGATION_FALLBACKS or server.js names them: the worker has no
  // offline fallback for the others, so precaching them would promise nothing.
  for (const [canonical, document] of documents) {
    if (isExcluded(canonical)) continue;
    addEntry(canonical);
    addEntry(document);
  }
  for (const [route, document] of serverRoutes) {
    if (!route.includes(":")) addEntry(route);
    addEntry(document);
  }

  /** @type {Map<string, string>} request key -> absolute file */
  const assets = new Map();
  /** @type {Array<{ file: string, pathname: string }>} */
  const queue = [];
  const parsed = new Set();

  /**
   * @param {string} reference
   * @param {string} basePathname
   * @param {{ required: boolean, from: string }} context
   */
  function addReference(reference, basePathname, context) {
    const trimmed = reference.trim();
    if (!trimmed || SKIPPED_SCHEMES.test(trimmed)) return;
    let url;
    try {
      url = new URL(trimmed, `${ORIGIN}${basePathname}`);
    } catch {
      return;
    }
    if (url.origin !== ORIGIN) return;
    if (isExcluded(url.pathname)) return;
    const file = fileFor(url.pathname);
    if (!file) {
      if (!context.required) return;
      throw new Error(
        `build-sw-assets: ${context.from} references missing local asset ${url.pathname}`,
      );
    }
    addAsset(`${url.pathname}${url.search}`, file, url.pathname);
  }

  /** @param {string} key @param {string} file @param {string} pathname */
  function addAsset(key, file, pathname) {
    if (!assets.has(key)) assets.set(key, file);
    if (parsed.has(file)) return;
    parsed.add(file);
    queue.push({ file, pathname });
  }

  for (const [requestPath, document] of entries) {
    addAsset(requestPath, fileFor(document), document);
  }
  for (const extra of EXTRA_ASSETS) {
    const glob = extra.match(/^(.*\/)\*\.(\w+)$/);
    if (!glob) {
      addReference(extra, "/", { required: true, from: "EXTRA_ASSETS" });
      continue;
    }
    const directory = path.join(publicDir, decodeURIComponent(glob[1]));
    const names = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith(`.${glob[2]}`))
      .sort(compare);
    if (!names.length)
      throw new Error(`build-sw-assets: EXTRA_ASSETS glob matched nothing: ${extra}`);
    for (const name of names) {
      addReference(`${glob[1]}${name}`, "/", { required: true, from: "EXTRA_ASSETS" });
    }
  }

  while (queue.length) {
    const { file, pathname } = /** @type {{ file: string, pathname: string }} */ (queue.shift());
    const extension = path.extname(file).toLowerCase();
    let references = {
      explicit: /** @type {string[]} */ ([]),
      literals: /** @type {string[]} */ ([]),
    };
    if (extension === ".html") references = htmlReferences(readText(file));
    else if (extension === ".js" || extension === ".mjs")
      references = javascriptReferences(readText(file));
    else if (extension === ".css") references = cssReferences(readText(file));
    else if (extension === ".webmanifest" || extension === ".json")
      references = manifestReferences(readText(file));
    for (const reference of references.explicit) {
      addReference(reference, pathname, { required: true, from: pathname });
    }
    for (const literal of references.literals) {
      addReference(literal, pathname, { required: false, from: pathname });
    }
  }

  const entryKeys = [...entries.keys()].sort(compare);
  const otherKeys = [...assets.keys()].filter((key) => !entries.has(key)).sort(compare);
  const orderedKeys = [...entryKeys, ...otherKeys];

  const hash = crypto.createHash("sha256");
  hash.update(`epoch:${CACHE_EPOCH}\n`);
  /** @type {Map<string, Buffer>} */
  const contents = new Map();
  for (const key of [...orderedKeys].sort(compare)) {
    const file = /** @type {string} */ (assets.get(key));
    let bytes = contents.get(file);
    if (!bytes) {
      bytes = fs.readFileSync(file);
      contents.set(file, bytes);
    }
    hash.update(key);
    hash.update("\0");
    hash.update(String(bytes.length));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\n");
  }
  const cacheName = `${CACHE_PREFIX}${hash.digest("hex").slice(0, 12)}`;

  return {
    swPath,
    cacheName,
    assets: orderedKeys,
    currentSource,
    source: replaceGeneratedBlock(currentSource, renderGeneratedBlock(cacheName, orderedKeys)),
    entries,
  };
}

/** @param {string} cacheName @param {string[]} assets */
export function renderGeneratedBlock(cacheName, assets) {
  const lines = [
    BEGIN_MARKER,
    `const CACHE = ${JSON.stringify(cacheName)};`,
    "const CORE_ASSETS = [",
  ];
  for (const asset of assets) lines.push(`  ${JSON.stringify(asset)},`);
  lines.push("];", END_MARKER);
  return lines.join("\n");
}

/** @param {string} source */
function generatedBlockRange(source) {
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(
      `build-sw-assets: public/sw.js must contain the markers "${BEGIN_MARKER}" and "${END_MARKER}"`,
    );
  }
  if (source.indexOf(BEGIN_MARKER, begin + 1) >= 0 || source.indexOf(END_MARKER, end + 1) >= 0) {
    throw new Error("build-sw-assets: the generated markers must appear exactly once");
  }
  return { begin, end: end + END_MARKER.length };
}

/** @param {string} source @param {string} block */
export function replaceGeneratedBlock(source, block) {
  const { begin, end } = generatedBlockRange(source);
  return `${source.slice(0, begin)}${block}${source.slice(end)}`;
}

/**
 * CACHE and CORE_ASSETS as currently written in a service worker source.
 * @param {string} source
 */
export function parseGeneratedBlock(source) {
  const { begin, end } = generatedBlockRange(source);
  const block = source.slice(begin, end);
  const cacheName = block.match(/const CACHE = "([^"]+)";/)?.[1] || "";
  const list = block.match(/const CORE_ASSETS = \[(.*?)\];/s)?.[1] || "";
  const assets = Array.from(list.matchAll(/"((?:[^"\\]|\\.)*)"/g), (entry) =>
    JSON.parse(`"${entry[1]}"`),
  );
  return { cacheName, assets };
}

/**
 * Human-readable differences between the shipped block and a fresh build.
 * @param {{ cacheName: string, assets: string[] }} current
 * @param {{ cacheName: string, assets: string[] }} next
 */
export function describeChanges(current, next) {
  const before = new Set(current.assets);
  const after = new Set(next.assets);
  const added = next.assets.filter((asset) => !before.has(asset));
  const removed = current.assets.filter((asset) => !after.has(asset));
  /** @type {string[]} */
  const summary = [];
  if (current.cacheName !== next.cacheName) {
    summary.push(`CACHE: ${current.cacheName || "(none)"} -> ${next.cacheName}`);
  }
  for (const asset of added) summary.push(`+ ${asset}`);
  for (const asset of removed) summary.push(`- ${asset}`);
  if (!added.length && !removed.length && current.cacheName !== next.cacheName) {
    summary.push("(asset list unchanged; the content of a precached file changed)");
  }
  return { added, removed, summary };
}

/**
 * Report whether public/sw.js matches what the generator would write.
 * @param {BuildOptions} [options]
 */
export function checkServiceWorkerAssets(options = {}) {
  const build = buildServiceWorkerAssets(options);
  const fresh = build.source === build.currentSource;
  const changes = describeChanges(parseGeneratedBlock(build.currentSource), build);
  const summary = fresh
    ? []
    : changes.summary.length
      ? changes.summary
      : ["(generated block formatting differs)"];
  return { fresh, summary, added: changes.added, removed: changes.removed, ...build };
}

/**
 * Rewrite the generated block in public/sw.js.
 * @param {BuildOptions} [options]
 */
export function writeServiceWorkerAssets(options = {}) {
  const check = checkServiceWorkerAssets(options);
  if (!check.fresh) fs.writeFileSync(check.swPath, check.source);
  return check;
}

function main() {
  const args = new Set(process.argv.slice(2));
  /** @param {string} file */
  const relative = (file) => path.relative(process.cwd(), file) || file;
  if (args.has("--help") || args.has("-h")) {
    console.log(
      "Usage: node src/scripts/build-sw-assets.mjs [--check] [--report]\n" +
        "  (no flag)  refresh ?v= asset versions, then rewrite the generated CACHE/CORE_ASSETS block in public/sw.js\n" +
        "  --check    exit 1 when asset versions or public/sw.js are stale\n" +
        "  --report   print the computed asset list and the changes against the shipped block",
    );
    return;
  }
  if (args.has("--report")) {
    const versions = checkAssetVersions();
    console.log(
      `asset versions: ${versions.versioned} references in ${versions.files.length} files` +
        (versions.fresh ? "" : ` (${versions.stale.length} stale)`),
    );
    const check = checkServiceWorkerAssets();
    console.log(`CACHE ${check.cacheName} (${check.assets.length} assets)`);
    for (const asset of check.assets) console.log(`  ${asset}`);
    console.log(check.fresh ? "\npublic/sw.js is up to date" : "\nChanges against public/sw.js:");
    for (const line of check.summary) console.log(`  ${line}`);
    return;
  }
  if (args.has("--check")) {
    const versions = checkAssetVersions();
    const check = checkServiceWorkerAssets();
    if (versions.fresh && check.fresh) {
      console.log(
        `asset versions are up to date (${versions.versioned} references in ${versions.files.length} files)`,
      );
      console.log(
        `${relative(check.swPath)} is up to date (${check.cacheName}, ${check.assets.length} assets)`,
      );
      return;
    }
    if (!versions.fresh) {
      console.error(
        `${versions.stale.length} file(s) carry stale ?v= asset versions. Run: npm run sw:build`,
      );
      for (const line of versions.summary) console.error(`  ${line}`);
    }
    if (!check.fresh) {
      console.error(`${relative(check.swPath)} is stale. Run: npm run sw:build`);
      for (const line of check.summary) console.error(`  ${line}`);
    }
    process.exitCode = 1;
    return;
  }
  const versions = writeAssetVersions();
  if (versions.fresh) {
    console.log(
      `asset versions already up to date (${versions.versioned} references in ${versions.files.length} files)`,
    );
  } else {
    console.log(`Refreshed ?v= asset versions in ${versions.stale.length} file(s)`);
    for (const line of versions.summary) console.log(`  ${line}`);
  }
  const written = writeServiceWorkerAssets();
  if (written.fresh) {
    console.log(
      `${relative(written.swPath)} already up to date (${written.cacheName}, ${written.assets.length} assets)`,
    );
  } else {
    console.log(
      `Wrote ${relative(written.swPath)} (${written.cacheName}, ${written.assets.length} assets)`,
    );
    for (const line of written.summary) console.log(`  ${line}`);
  }
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === SCRIPT_PATH;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
