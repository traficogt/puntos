import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("marketing and app hosts stay explicitly configured for production", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture.
  const envExample = fs.readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture.
  const compose = fs.readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");
  assert.match(envExample, /^APP_ORIGIN=https:\/\/[^\n]+/m);
  assert.match(envExample, /^MARKETING_ORIGIN=https:\/\/puntosfieles\.com/m);
  assert.match(compose, /APP_ORIGIN:/);
  assert.match(compose, /MARKETING_ORIGIN:/);
});
