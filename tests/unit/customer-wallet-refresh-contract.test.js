import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/customer.html");
const indexPath = path.join(process.cwd(), "public/customer/index.js");
const loadPath = path.join(process.cwd(), "public/customer/load.js");
const cssPath = path.join(process.cwd(), "public/styles/customer-wallet-refresh.css");

test("customer wallet exposes a manual refresh control", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(html, /id="btnRefreshWallet"/);
  assert.match(html, /customer-wallet-refresh\.css/);
  assert.match(css, /#btnRefreshWallet/);
});

test("customer wallet adds silent auto-refresh hooks", () => {
  const js = fs.readFileSync(indexPath, "utf8");

  assert.match(js, /function refreshWallet/);
  assert.match(js, /window\.addEventListener\("focus"/);
  assert.match(js, /document\.addEventListener\("visibilitychange"/);
  assert.match(js, /window\.setInterval\(/);
  assert.match(js, /btnRefreshWallet/);
});

test("manual refresh can force a visible reload message while initial load stays silent", () => {
  const load = fs.readFileSync(loadPath, "utf8");
  const js = fs.readFileSync(indexPath, "utf8");

  assert.match(load, /silent = false/);
  assert.match(js, /loadAll\(\{ api, \$, toast, silent: true \}\)/);
  assert.match(js, /refreshWallet\(\{ silent: false \}\)/);
});
