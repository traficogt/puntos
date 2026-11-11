import test from "node:test";
import assert from "node:assert/strict";
import { pageFromHash, hashForPage } from "../src/navigation.js";
test("bookmarked legacy fragments and Spanish fragments lead to the same view", () => {
  for (const [page, fragment] of [["fulfillment", "canjes"], ["overview", "resumen"], ["launch", "preparar"], ["campaigns", "campanas"], ["recovery", "recuperar-clientes"]]) {
    assert.equal(pageFromHash(`#${page}`), page);
    assert.equal(pageFromHash(`#${fragment}`), page);
    assert.equal(hashForPage(page), `#${fragment}`);
  }
  assert.equal(pageFromHash("#unknown"), null);
});
