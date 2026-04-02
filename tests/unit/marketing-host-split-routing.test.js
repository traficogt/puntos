import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("marketing and app hosts stay split by config and local defaults", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const envExample = fs.readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const localEnv = fs.readFileSync(new URL("../../.env", import.meta.url), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const compose = fs.readFileSync(new URL("../../docker-compose.yml", import.meta.url), "utf8");

  assert.match(envExample, /MARKETING_ORIGIN=https:\/\/puntosfieles\.com/);
  assert.match(localEnv, /APP_ORIGIN=http:\/\/app\.localhost:3001/);
  assert.match(localEnv, /MARKETING_ORIGIN=http:\/\/localhost:3001/);
  assert.match(compose, /MARKETING_ORIGIN:/);
});
