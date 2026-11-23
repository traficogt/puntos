import fs from "node:fs/promises";

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const IMPORT_SPECIFIER = /^\s*(?:import|export)\s+(?:[^;"']*?\bfrom\s*)?"([^"]+)"/gm;

/**
 * Loads a browser ES module from the repository as a `data:` URL so unit tests can
 * stub its dependencies without a bundler. Relative imports are rewritten
 * recursively (each module gets a fresh instance per `instance` tag); `stubs` maps
 * an import specifier exactly as written in the source (e.g. "/lib.js" or
 * "./view-state.js") to either a module URL or inline module source. Absolute
 * specifiers that are not stubbed fail loudly instead of resolving to the file system.
 *
 * @param {URL} entryUrl
 * @param {{ stubs?: Record<string, string>, instance?: string | number }} [options]
 */
export async function loadBrowserModule(entryUrl, { stubs = {}, instance = "" } = {}) {
  const cache = new Map();

  async function rewrite(fileUrl) {
    if (cache.has(fileUrl.href)) return cache.get(fileUrl.href);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Repository module named by the test.
    const source = await fs.readFile(fileUrl, "utf8");
    // JSDoc import types are comments, not dependencies.
    const runtimeSource = source.replace(/\/\*[\s\S]*?\*\//g, "");
    let rewritten = source;
    for (const [, specifier] of runtimeSource.matchAll(IMPORT_SPECIFIER)) {
      let replacement;
      if (Object.hasOwn(stubs, specifier)) {
        const stub = stubs[specifier];
        replacement = /^(?:data|file|https?):/.test(stub) ? stub : dataUrl(stub);
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        replacement = await rewrite(new URL(specifier, fileUrl));
      } else {
        throw new Error(`Unstubbed import ${JSON.stringify(specifier)} in ${fileUrl.pathname}`);
      }
      rewritten = rewritten.replaceAll(JSON.stringify(specifier), JSON.stringify(replacement));
    }
    const url = dataUrl(`${rewritten}\n// instance ${instance} ${fileUrl.pathname}`);
    cache.set(fileUrl.href, url);
    return url;
  }

  return import(await rewrite(entryUrl));
}
