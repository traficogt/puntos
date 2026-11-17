import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = new URL("../../src/", import.meta.url);

async function sourceFiles(directory) {
  // Fixed repository source tree only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceFiles(target);
    return entry.name.endsWith(".js") || entry.name.endsWith(".mjs") ? [target] : [];
  }));
  return nested.flat();
}

test("money sums and averages in queries are never cast to numeric(10,2)", async () => {
  // A sum of numeric(10,2) amounts exceeds 99,999,999.99 in currencies such as COP;
  // casting the aggregate back to numeric(10,2) turns valid reports into errors.
  const offenders = [];
  for (const file of await sourceFiles(root)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const text = await fs.readFile(file, "utf8");
    if (/::\s*(numeric|decimal)\s*\(\s*10\s*,\s*2\s*\)/i.test(text)) offenders.push(path.relative(root.pathname, file.pathname));
  }
  assert.deepEqual(offenders, []);
});
