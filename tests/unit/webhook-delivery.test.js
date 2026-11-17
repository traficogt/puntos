import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { deliveryLeaseSeconds, sendPinnedWebhook } from "../../src/app/services/webhook-service.js";

describe("pinned outbound webhook delivery", () => {
  const requests = [];
  let server, port, redirectTarget, redirectHits = 0;
  before(async () => {
    redirectTarget = http.createServer((_req, res) => { redirectHits += 1; res.end("redirected"); });
    await new Promise(resolve => redirectTarget.listen(0, "127.0.0.1", resolve));
    server = http.createServer((req, res) => {
      requests.push({ url: req.url, host: req.headers.host, method: req.method });
      if (req.url === "/redirect") {
        res.writeHead(307, { location: `http://127.0.0.1:${redirectTarget.address().port}/internal` });
        res.end();
      } else if (req.url === "/drip") {
        // Keeps sending bytes faster than the idle timeout, forever.
        res.writeHead(200);
        const timer = setInterval(() => res.write("."), 20);
        res.on("close", () => clearInterval(timer));
      } else {
        req.resume();
        req.on("end", () => res.end("ok"));
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => redirectTarget.close(resolve));
  });

  const send = (path, timeoutMs = 2000) => sendPinnedWebhook({
    // .invalid never resolves: reaching the server proves the pinned address was dialed.
    url: new URL(`http://hooks.invalid:${port}${path}`),
    resolvedAddress: "127.0.0.1",
    resolvedFamily: 4,
    timeoutMs,
    body: "{}",
    headers: { "Content-Type": "application/json" }
  });

  it("dials the validated address for a hostname URL without a new DNS lookup", async () => {
    const out = await send("/hook");
    assert.equal(out.statusCode, 200);
    assert.deepEqual(requests.at(-1), { url: "/hook", host: `hooks.invalid:${port}`, method: "POST" });
  });

  it("does not follow redirects to another address", async () => {
    const out = await send("/redirect");
    assert.equal(out.statusCode, 307);
    assert.equal(redirectHits, 0);
  });

  it("bounds the whole exchange, not only idle time", async () => {
    const started = Date.now();
    await assert.rejects(send("/drip", 300), { name: "AbortError", message: "Timeout" });
    assert.ok(Date.now() - started < 2000);
  });

  it("sizes the delivery lease for every round of a claimed batch", () => {
    // 25 jobs at concurrency 5 is five rounds of DNS (8 s) + HTTP (8 s), plus a minute.
    assert.equal(deliveryLeaseSeconds({ batchSize: 25, concurrency: 5, timeoutMs: 8000 }), 140);
    assert.equal(deliveryLeaseSeconds({ batchSize: 25, concurrency: 25, timeoutMs: 8000 }), 76);
  });
});
