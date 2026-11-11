/* eslint-disable security/detect-non-literal-fs-filename -- Paths are local fixtures in a private temporary directory. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect as http2Connect, createSecureServer } from "node:http2";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createAppleProvider } from "../../src/app/services/native-wallet/apple.js";

let fixtureDir;
let config;
const snapshot = {
  id: "internal-pass-id",
  serial_number: "pf-serial-1",
  authentication_token: randomBytes(32).toString("base64url"),
  barcode: `pfw_${randomBytes(24).toString("base64url")}`,
  customer_name: "María",
  business_name: "Café Fiel",
  points: 125,
  pending_points: 12,
  revoked_at: null,
  revision: "7"
};

function openssl(args) {
  return execFileSync("openssl", args, { cwd: fixtureDir, stdio: ["ignore", "pipe", "pipe"] });
}

before(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "pf-apple-wallet-test-"));
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=Ephemeral Wallet Test CA"]);
  openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "signer.key", "-out", "signer.csr", "-subj", "/UID=pass.com.puntosfieles.loyalty/CN=Pass Type ID/OU=PFTEST1234/O=Puntos Fieles", "-addext", "subjectAltName=DNS:localhost"]);
  openssl(["x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-set_serial", "2", "-out", "signer.pem", "-days", "2", "-copy_extensions", "copy"]);
  config = {
    passTypeIdentifier: "pass.com.puntosfieles.loyalty",
    teamIdentifier: "PFTEST1234",
    organizationName: "Puntos Fieles",
    certificateFile: join(fixtureDir, "signer.pem"),
    privateKeyFile: join(fixtureDir, "signer.key"),
    wwdrCertificateFile: join(fixtureDir, "ca.pem"),
    webServiceUrl: "https://app.puntosfieles.com/api/wallet/apple",
    appOrigin: "https://app.puntosfieles.com"
  };
});
after(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function unzip(buffer) {
  const entries = {};
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(start, start + size);
    assert.ok(method === 0 || method === 8, "standard ZIP compression");
    entries[name] = method === 8 ? inflateRawSync(data) : data;
    offset = start + size;
  }
  return entries;
}

function transport({ status = 200, body = "", failure = "" } = {}) {
  const calls = [];
  const session = new EventEmitter();
  const request = new EventEmitter();
  const state = { closed: false, destroyed: false, requestDestroyed: false };
  Object.assign(session, {
    close() { state.closed = true; },
    destroy() { state.destroyed = true; },
    request(headers) {
      calls.push({ headers });
      if (failure === "request-throw") throw new Error("secret request error");
      return request;
    }
  });
  Object.assign(request, {
    setEncoding() {},
    close() { state.requestDestroyed = true; },
    destroy() { state.requestDestroyed = true; },
    end(payload) {
      calls.push({ payload });
      queueMicrotask(() => {
        if (failure === "timeout") return;
        if (failure === "session") return session.emit("error", new Error("secret TLS error"));
        if (failure === "stream") return request.emit("error", new Error("secret stream error"));
        if (failure === "close") return request.emit("close");
        if (failure === "goaway") return session.emit("goaway", 0, 0, Buffer.from("secret"));
        request.emit("response", { ":status": status });
        if (body) request.emit("data", body);
        request.emit("end");
      });
    }
  });
  // Injecting this boundary prevents sending fixture certificates or tokens to Apple.
  const connect = (...args) => {
    calls.push({ args });
    if (failure === "connect-throw") throw new Error("secret connection error");
    return /** @type {import("node:http2").ClientHttp2Session} */ (/** @type {unknown} */ (session));
  };
  return { connect, calls, state };
}

describe("Apple Wallet signed passes", () => {
  it("creates a ZIP whose manifest and detached PKCS#7 signature verify independently", async () => {
    const pass = await createAppleProvider(config).generatePass(snapshot);
    assert.ok(Buffer.isBuffer(pass));
    const entries = unzip(pass);
    assert.deepEqual(Object.keys(entries).sort(), ["icon.png", "icon@2x.png", "icon@3x.png", "manifest.json", "pass.json", "signature"].sort());
    const manifest = JSON.parse(entries["manifest.json"].toString("utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), Object.keys(entries).filter((name) => !["manifest.json", "signature"].includes(name)).sort());
    for (const [name, digest] of Object.entries(manifest)) {
      assert.equal(createHash("sha1").update(entries[name]).digest("hex"), digest);
    }
    for (const [name, size] of [["icon.png", 29], ["icon@2x.png", 58], ["icon@3x.png", 87]]) {
      assert.equal(entries[name].readUInt32BE(16), size);
      assert.equal(entries[name].readUInt32BE(20), size);
    }
    writeFileSync(join(fixtureDir, "manifest.json"), entries["manifest.json"]);
    writeFileSync(join(fixtureDir, "signature"), entries.signature);
    const verified = openssl(["cms", "-verify", "-binary", "-inform", "DER", "-in", "signature", "-content", "manifest.json", "-CAfile", "ca.pem", "-purpose", "any"]);
    assert.deepEqual(verified, entries["manifest.json"]);
    const cms = openssl(["cms", "-cmsout", "-print", "-inform", "DER", "-in", "signature"]).toString("utf8");
    assert.match(cms, /signingTime/);
    assert.match(cms, /Ephemeral Wallet Test CA/);
    assert.match(cms, /eContent: <ABSENT>/);
  });

  it("encodes the QR, balances, stable update credentials and safe customer links", async () => {
    const entries = unzip(await createAppleProvider(config).generatePass({ ...snapshot, phone: "+50255555555", email: "private@example.test" }));
    const pass = JSON.parse(entries["pass.json"].toString("utf8"));
    assert.equal(pass.formatVersion, 1);
    assert.equal(pass.passTypeIdentifier, config.passTypeIdentifier);
    assert.equal(pass.teamIdentifier, config.teamIdentifier);
    assert.equal(pass.organizationName, "Puntos Fieles");
    assert.equal(pass.serialNumber, snapshot.serial_number);
    assert.equal(pass.authenticationToken, snapshot.authentication_token);
    assert.equal(pass.webServiceURL, config.webServiceUrl);
    assert.equal(pass.voided, false);
    assert.deepEqual(pass.barcodes, [{ format: "PKBarcodeFormatQR", message: snapshot.barcode, messageEncoding: "iso-8859-1" }]);
    const fields = [...pass.storeCard.primaryFields, ...pass.storeCard.secondaryFields, ...pass.storeCard.auxiliaryFields, ...pass.storeCard.backFields];
    assert.equal(fields.find((field) => field.key === "points").value, 125);
    assert.equal(fields.find((field) => field.key === "pending_points").value, 12);
    assert.equal(fields.find((field) => field.key === "customer_name").value, "María");
    assert.equal(fields.find((field) => field.key === "customer_link").value, `${config.appOrigin}/mi-tarjeta/`);
    assert.equal(fields.find((field) => field.key === "support_link").value, "https://puntosfieles.com/soporte");
    assert.doesNotMatch(entries["pass.json"].toString(), /55555555|private@example|internal-pass-id/);
    assert.deepEqual(entries["icon.png"], readFileSync(new URL("../../public/images/wallet/apple-icon.png", import.meta.url)));
  });

  it("signs scoped location and progress fields without pretending refresh is a visible alert", async () => {
    const wallet_engagement = { usage: "Los puntos pendientes aún no se pueden canjear.", progress: "Te faltan 25 puntos para Café.", earning: "2 puntos por GTQ 1.", conditions: "Canje en: Centro.", locations: [{ name: "Centro", latitude: 14.6, longitude: -90.5 }] };
    const pass = JSON.parse(unzip(await createAppleProvider(config).generatePass({ ...snapshot, wallet_engagement }))["pass.json"].toString());
    const fields = [...pass.storeCard.secondaryFields, ...pass.storeCard.backFields];
    assert.equal(fields.find(field => field.key === "reward_progress").value, wallet_engagement.progress);
    assert.equal(fields.find(field => field.key === "card_usage").value, wallet_engagement.usage);
    assert.deepEqual(pass.locations, [{ latitude: 14.6, longitude: -90.5, relevantText: "Tu tarjeta de puntos en Centro" }]);
    assert.ok(fields.every(field => !field.changeMessage));
    const voided = JSON.parse(unzip(await createAppleProvider(config).generatePass({ ...snapshot, wallet_engagement, is_voided: true }))["pass.json"].toString());
    assert.equal(voided.voided, true);
    assert.equal(voided.storeCard.primaryFields[0].value, 0);
    assert.deepEqual(voided.locations, []);
    assert.equal(voided.storeCard.backFields.some(field => field.key === "earning_terms"), false);
    assert.equal(voided.storeCard.backFields.some(field => field.key === "card_usage"), false);
  });

  it("voids revoked passes while preserving serial and authentication token on updates", async () => {
    const pass = JSON.parse(unzip(await createAppleProvider(config).generatePass({ ...snapshot, points: 0, customer_name: null, revoked_at: new Date().toISOString(), revision: "8" }))["pass.json"].toString());
    assert.equal(pass.voided, true);
    assert.equal(pass.serialNumber, snapshot.serial_number);
    assert.equal(pass.authenticationToken, snapshot.authentication_token);
    assert.equal(pass.storeCard.secondaryFields.some((field) => field.key === "customer_name"), false);
  });

  it("fails closed without exposing missing certificate paths, key data or tokens", async () => {
    const provider = createAppleProvider({ ...config, privateKeyFile: join(fixtureDir, "sensitive-missing.pem") });
    await assert.rejects(provider.generatePass(snapshot), { message: "Apple Wallet signing is not configured correctly.", code: "APPLE_WALLET_CONFIGURATION_INVALID" });
  });

  it("signs with a passphrase-protected PEM key and fails closed for a wrong passphrase", async () => {
    const passphrase = randomBytes(32).toString("base64url");
    writeFileSync(join(fixtureDir, "test-key-passphrase"), passphrase, { mode: 0o600 });
    openssl(["pkcs8", "-topk8", "-in", "signer.key", "-out", "encrypted.key", "-v2", "aes-256-cbc", "-passout", "file:test-key-passphrase"]);
    const encryptedConfig = { ...config, privateKeyFile: join(fixtureDir, "encrypted.key"), privateKeyPassphrase: passphrase };
    const entries = unzip(await createAppleProvider(encryptedConfig).generatePass(snapshot));
    writeFileSync(join(fixtureDir, "encrypted-manifest.json"), entries["manifest.json"]);
    writeFileSync(join(fixtureDir, "encrypted-signature"), entries.signature);
    assert.deepEqual(openssl(["cms", "-verify", "-binary", "-inform", "DER", "-in", "encrypted-signature", "-content", "encrypted-manifest.json", "-CAfile", "ca.pem", "-purpose", "any"]), entries["manifest.json"]);
    await assert.rejects(createAppleProvider({ ...encryptedConfig, privateKeyPassphrase: "incorrect-fixture-passphrase" }).generatePass(snapshot), { code: "APPLE_WALLET_CONFIGURATION_INVALID" });
    const wire = transport();
    await createAppleProvider(encryptedConfig, { connect: wire.connect }).pushUpdate(randomBytes(32).toString("hex"));
    assert.equal(wire.calls[0].args[1].passphrase, passphrase);
  });

  it("rejects certificate identity mismatch, unrelated signing key and insecure URLs", async () => {
    for (const override of [
      { teamIdentifier: "OTHER12345" },
      { passTypeIdentifier: "pass.com.other.loyalty" },
      { privateKeyFile: join(fixtureDir, "ca.key") },
      { webServiceUrl: "http://app.puntosfieles.com/wallet" },
      { appOrigin: "https://user:secret@app.puntosfieles.com" }
    ]) {
      await assert.rejects(createAppleProvider({ ...config, ...override }).generatePass(snapshot), { code: "APPLE_WALLET_CONFIGURATION_INVALID" });
    }
  });

  it("rejects malformed snapshot data instead of producing a silently incomplete pass", async () => {
    for (const override of [{ authentication_token: "short" }, { barcode: "" }, { points: NaN }, { serial_number: "" }]) {
      await assert.rejects(createAppleProvider(config).generatePass({ ...snapshot, ...override }), { code: "APPLE_WALLET_PASS_FAILED" });
    }
  });

  it("refuses signing when the configured certificates are outside their validity period", async (t) => {
    t.mock.method(Date, "now", () => Date.parse("2100-01-01T00:00:00Z"));
    await assert.rejects(createAppleProvider(config).generatePass(snapshot), { code: "APPLE_WALLET_CONFIGURATION_INVALID" });
  });
});

describe("Apple Wallet APNs update delivery", () => {
  const token = randomBytes(32).toString("hex");

  it("uses production HTTP/2, pass certificate authentication and an empty JSON payload", async () => {
    const wire = transport();
    const provider = createAppleProvider(config, { connect: wire.connect });
    const result = await provider.pushUpdate(token);
    assert.deepEqual(result, { invalidToken: false });
    assert.equal(wire.calls[0].args[0], "https://api.push.apple.com");
    assert.deepEqual(wire.calls[0].args[1].cert, readFileSync(config.certificateFile));
    assert.deepEqual(wire.calls[0].args[1].key, readFileSync(config.privateKeyFile));
    assert.equal(wire.calls[0].args[1].rejectUnauthorized, true);
    assert.equal(wire.calls[1].headers[":method"], "POST");
    assert.equal(wire.calls[1].headers[":path"], `/3/device/${token}`);
    assert.equal(wire.calls[1].headers["apns-topic"], config.passTypeIdentifier);
    const expiry=Number(wire.calls[1].headers["apns-expiration"]);
    assert.ok(expiry > Date.now()/1000 + 6*24*60*60 && expiry <= Date.now()/1000 + 7*24*60*60);
    assert.equal(wire.calls[1].headers["apns-collapse-id"], "pf-wallet-update");
    assert.equal(wire.calls[1].headers["apns-priority"], "5");
    assert.equal(wire.calls[2].payload, "{}");
    provider.close();
    assert.ok(wire.state.closed || wire.state.destroyed);
  });

  it("reuses the APNs connection across updates and releases it on close", async () => {
    const wire = transport();
    const provider = createAppleProvider(config, { connect: wire.connect });
    await provider.pushUpdate(token);
    await provider.pushUpdate(token);
    assert.equal(wire.calls.filter((call) => call.args).length, 1);
    assert.equal(wire.calls.filter((call) => call.payload === "{}").length, 2);
    assert.equal(wire.state.closed, false);
    provider.close();
    assert.ok(wire.state.closed || wire.state.destroyed);
  });

  it("delivers over a real local HTTP/2 TLS connection with mutual certificate authentication", async (t) => {
    const ca = readFileSync(config.wwdrCertificateFile);
    const server = createSecureServer({ key: readFileSync(config.privateKeyFile), cert: readFileSync(config.certificateFile), ca, requestCert: true, rejectUnauthorized: true });
    const received = [];
    let sessions = 0;
    server.on("session", () => { sessions += 1; });
    server.on("stream", (stream, headers) => {
      let body = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { body += chunk; });
      stream.on("end", () => {
        received.push({ headers, body, authorized: /** @type {import("node:tls").TLSSocket} */ (stream.session.socket).authorized });
        /** @type {import("node:http2").ServerHttp2Stream} */ (stream).respond({ ":status": 200 });
        stream.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const provider = createAppleProvider(config, {
      connect: (_origin, options) => http2Connect(`https://localhost:${address.port}`, { ...options, ca }),
      timeoutMs: 2000
    });
    t.after(() => provider.close());
    assert.deepEqual(await provider.pushUpdate(token), { invalidToken: false });
    assert.deepEqual(await Promise.all([provider.pushUpdate(token), provider.pushUpdate(token)]), [{ invalidToken: false }, { invalidToken: false }]);
    provider.close();
    assert.equal(received.length, 3);
    assert.equal(sessions, 1);
    assert.equal(received[0].body, "{}");
    assert.equal(received[0].headers[":path"], `/3/device/${token}`);
    assert.equal(received[0].authorized, true);
  });

  it("identifies definitively invalid tokens without classifying provider failures as invalid", async () => {
    for (const { status, reason } of [{ status: 410, reason: "Unregistered" }, { status: 400, reason: "BadDeviceToken" }]) {
      const wire = transport({ status, body: JSON.stringify({ reason }) });
      assert.deepEqual(await createAppleProvider(config, { connect: wire.connect }).pushUpdate(token), { invalidToken: true });
    }
    const failures = [
      { status: 403, body: '{"reason":"BadCertificate"}' },
      { status: 429, body: '{"reason":"TooManyRequests"}' },
      { status: 503, body: "secret-provider-body" },
      { status: 400, body: '{"reason":"DeviceTokenNotForTopic"}' },
      { status: 410, body: "invalid-json" }
    ];
    for (const { status, body } of failures) {
      const wire = transport({ status, body });
      await assert.rejects(createAppleProvider(config, { connect: wire.connect }).pushUpdate(token), { code: "APPLE_WALLET_PUSH_FAILED", message: "Apple Wallet update could not be delivered." });
      assert.ok(wire.state.closed || wire.state.destroyed);
    }
  });

  it("bounds connection, response and protocol failures with sanitized errors", async () => {
    for (const failure of ["connect-throw", "request-throw", "session", "stream", "close", "goaway", "timeout"]) {
      const wire = transport({ failure });
      await assert.rejects(createAppleProvider(config, { connect: wire.connect, timeoutMs: 25 }).pushUpdate(token), { code: "APPLE_WALLET_PUSH_FAILED", message: "Apple Wallet update could not be delivered." });
      if (failure !== "connect-throw") assert.ok(wire.state.closed || wire.state.destroyed, failure);
    }
  });

  it("bounds response bodies and rejects malformed tokens before opening a connection", async () => {
    const wire = transport({ status: 503, body: "x".repeat(8193) });
    await assert.rejects(createAppleProvider(config, { connect: wire.connect }).pushUpdate(token), { code: "APPLE_WALLET_PUSH_FAILED" });
    for (const malformed of ["", "token/with-path", "a\r\nheader", "ab".repeat(513)]) {
      const invalidWire = transport();
      await assert.rejects(createAppleProvider(config, { connect: invalidWire.connect }).pushUpdate(malformed), { code: "APPLE_WALLET_PUSH_FAILED" });
      assert.equal(invalidWire.calls.length, 0);
    }
  });
});
