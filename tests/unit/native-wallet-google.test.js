import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { jwtVerify } from "jose";
import { createGoogleProvider } from "../../src/app/services/native-wallet/google.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuedAt = Date.parse("2026-11-09T12:00:00.000Z");
const config = {
  issuerId: "3388000000022220000",
  serviceAccountEmail: "wallet@pf-example.iam.gserviceaccount.com",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  privateKeyId: "test-key-id",
  appOrigin: "https://app.example.com",
  logoUrl: "https://app.example.com/icon-512.png",
  organizationName: "PF"
};
const snapshot = {
  id: "11111111-2222-4333-8444-555555555555",
  serial_number: "pf-member-001",
  barcode: "pf-wallet:test-opaque-barcode",
  customer_name: "María Pérez",
  business_name: "Café del Centro",
  business_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  customer_id: "22222222-3333-4444-8555-666666666666",
  points: 125,
  pending_points: 12,
  revoked_at: null,
  revision: 7
};
const classId = `${config.issuerId}.pf_aaaaaaaabbbb4ccc8dddeeeeeeeeeeee`;
const objectId = `${config.issuerId}.pf_11111111222243338444555555555555`;
const apiBase = "https://walletobjects.googleapis.com/walletobjects/v1";
const tokenUrl = "https://oauth2.googleapis.com/token";
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** @param {{ hook?: (request: any, state: any) => any, config?: any, expiresIn?: number }} [options] */
function harness(options = {}) {
  const state = { requests: [], classes: new Map(), objects: new Map(), time: issuedAt, tokens: 0 };
  const fetchImpl = async (url, init) => {
    const body = init.body && init.headers["Content-Type"] === "application/json" ? JSON.parse(init.body) : init.body;
    const request = { url: String(url), init, body };
    state.requests.push(request);
    const override = await options.hook?.(request, state);
    if (override) return override;
    if (url === tokenUrl) {
      state.tokens += 1;
      return jsonResponse(200, { access_token: `test-token-${state.tokens}`, expires_in: options.expiresIn ?? 3600, token_type: "Bearer" });
    }
    assert.ok(String(url).startsWith(`${apiBase}/`), "only the fixed Google Wallet endpoint is used");
    const [collection, id] = String(url).slice(apiBase.length + 1).split("/");
    const resources = collection === "loyaltyClass" ? state.classes : state.objects;
    if (init.method === "GET") return resources.has(id) ? jsonResponse(200, resources.get(id)) : jsonResponse(404, {});
    if (init.method === "POST") {
      if (resources.has(body.id)) return jsonResponse(409, {});
      resources.set(body.id, body);
      return jsonResponse(200, body);
    }
    if (init.method === "PATCH") {
      if (!resources.has(id)) return jsonResponse(404, {});
      const updated = { ...resources.get(id), ...body };
      resources.set(id, updated);
      return jsonResponse(200, updated);
    }
    assert.fail(`Unexpected Google Wallet method: ${init.method}`);
  };
  return { state, provider: createGoogleProvider(options.config ?? config, { fetchImpl, now: () => state.time }) };
}

test("Google save creates a business class and pass object before signing a compact existing-object link", async () => {
  const { provider, state } = harness();
  const url = await provider.savePass(snapshot);
  assert.ok(url.startsWith("https://pay.google.com/gp/v/save/"));
  const token = url.slice("https://pay.google.com/gp/v/save/".length);
  const verified = await jwtVerify(token, publicKey, { algorithms: ["RS256"], audience: "google", issuer: config.serviceAccountEmail, currentDate: new Date(issuedAt) });
  assert.equal(verified.protectedHeader.kid, config.privateKeyId);
  assert.equal(verified.payload.typ, "savetowallet");
  assert.equal(verified.payload.iat, issuedAt / 1000);
  assert.deepEqual(verified.payload.origins, [config.appOrigin]);
  assert.deepEqual(verified.payload.payload, { loyaltyObjects: [{ id: objectId }] });
  assert.ok(token.length < 1800);
  const passClass = state.classes.get(classId);
  assert.equal(passClass.programName, snapshot.business_name);
  assert.equal(passClass.localizedProgramName.defaultValue.value, snapshot.business_name);
  assert.equal(passClass.localizedProgramName.defaultValue.language, "es-GT");
  assert.equal(passClass.issuerName, "PF");
  assert.equal(passClass.reviewStatus, "UNDER_REVIEW");
  assert.equal(passClass.programLogo.sourceUri.uri, config.logoUrl);
  const object = state.objects.get(objectId);
  assert.equal(object.classId, classId);
  assert.equal(object.accountId, snapshot.serial_number);
  assert.equal(object.accountName, snapshot.customer_name);
  assert.equal(object.state, "ACTIVE");
  assert.deepEqual(object.barcode, { type: "QR_CODE", value: snapshot.barcode });
  assert.deepEqual(object.loyaltyPoints.balance, { int: 125 });
  assert.deepEqual(object.secondaryLoyaltyPoints.balance, { int: 12 });
  assert.equal(state.requests.at(-1).init.method, "POST");
});

test("OAuth assertions use RS256, one-hour lifetime and only the wallet issuer scope", async () => {
  const { provider, state } = harness();
  await provider.savePass(snapshot);
  const request = state.requests[0];
  assert.equal(request.url, tokenUrl);
  assert.equal(request.init.method, "POST");
  const form = new URLSearchParams(request.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const { payload } = await jwtVerify(form.get("assertion"), publicKey, { algorithms: ["RS256"], audience: tokenUrl, issuer: config.serviceAccountEmail, currentDate: new Date(issuedAt) });
  assert.equal(payload.scope, "https://www.googleapis.com/auth/wallet_object.issuer");
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.sub, undefined);
  for (const { init } of state.requests) {
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("repeated saves retain stable identifiers and reconcile the authoritative point balance", async () => {
  const { provider, state } = harness();
  await provider.savePass(snapshot);
  await provider.savePass({ ...snapshot, points: 18, pending_points: 0, revision: 8 });
  assert.equal(state.classes.size, 1);
  assert.equal(state.objects.size, 1);
  assert.deepEqual(state.objects.get(objectId).loyaltyPoints.balance, { int: 18 });
  assert.deepEqual(state.objects.get(objectId).secondaryLoyaltyPoints.balance, { int: 0 });
  assert.equal(state.tokens, 1);
});

test("active updates reconcile business names before balances and submit changed branding for review", async () => {
  const { provider, state } = harness();
  await provider.savePass(snapshot);
  const originalClass = state.classes.get(classId);
  originalClass.reviewStatus = "APPROVED";
  originalClass.homepageUri = { uri: "https://app.example.com/business" };
  const renamed = { ...snapshot, business_name: "Café del Parque", points: 130 };
  const start = state.requests.length;

  await provider.updatePass(renamed);

  const updatedClass = state.classes.get(classId);
  assert.equal(updatedClass.programName, renamed.business_name);
  assert.deepEqual(updatedClass.localizedProgramName, { defaultValue: { language: "es-GT", value: renamed.business_name } });
  assert.equal(updatedClass.reviewStatus, "UNDER_REVIEW");
  assert.deepEqual(updatedClass.homepageUri, originalClass.homepageUri);
  const writes = state.requests.slice(start).filter(request => request.init.method === "PATCH");
  assert.deepEqual(writes.map(request => request.url), [`${apiBase}/loyaltyClass/${classId}`, `${apiBase}/loyaltyObject/${objectId}`]);
  assert.deepEqual(writes[0].body, {
    programName: renamed.business_name,
    localizedProgramName: { defaultValue: { language: "es-GT", value: renamed.business_name } },
    reviewStatus: "UNDER_REVIEW"
  });

  updatedClass.reviewStatus = "APPROVED";
  await provider.updatePass({ ...renamed, points: 135 });
  assert.equal(state.classes.get(classId).reviewStatus, "APPROVED");
  assert.equal(state.requests.filter(request => request.init.method === "PATCH" && request.url.includes("loyaltyClass/")).length, 1);
});

test("saving reconciles stale issuer branding without replacing unrelated class fields", async () => {
  const { provider, state } = harness();
  await provider.savePass(snapshot);
  const passClass = state.classes.get(classId);
  passClass.issuerName = "Old issuer";
  passClass.programLogo = { sourceUri: { uri: "https://app.example.com/old-logo.png" } };
  passClass.localizedProgramName.translatedValues = [{ language: "en-US", value: "Central Café" }];
  const translations = passClass.localizedProgramName.translatedValues;
  await provider.savePass(snapshot);
  const patched = state.classes.get(classId);
  assert.equal(patched.issuerName, config.organizationName);
  assert.equal(patched.programLogo.sourceUri.uri, config.logoUrl);
  assert.deepEqual(patched.localizedProgramName.translatedValues, translations);
  const patch = state.requests.find(request => request.init.method === "PATCH" && request.url.includes("loyaltyClass/"));
  assert.deepEqual(Object.keys(patch.body).sort(), ["issuerName", "programLogo", "reviewStatus"]);
});

test("revocation never overwrites existing business branding, even when recreating a missing object", async () => {
  for (const missingObject of [false, true]) {
    const { provider, state } = harness();
    await provider.savePass(snapshot);
    state.classes.get(classId).reviewStatus = "APPROVED";
    const originalClass = structuredClone(state.classes.get(classId));
    if (missingObject) state.objects.delete(objectId);
    const start = state.requests.length;
    await provider.updatePass({ ...snapshot, revoked_at: new Date(issuedAt), business_name: "PuntosFieles", customer_name: null });
    assert.deepEqual(state.classes.get(classId), originalClass);
    assert.equal(state.objects.get(objectId).state, "INACTIVE");
    assert.equal(state.requests.slice(start).some(request => request.init.method === "PATCH" && request.url.includes("loyaltyClass/")), false);
  }
});

test("revocation can create a missing class and object without an active pass", async () => {
  const { provider, state } = harness();
  await provider.updatePass({ ...snapshot, revoked_at: new Date(issuedAt), business_name: "PuntosFieles", customer_name: null });
  assert.equal(state.classes.get(classId).reviewStatus, "UNDER_REVIEW");
  assert.equal(state.objects.get(objectId).state, "INACTIVE");
  assert.equal(state.requests.some(request => request.init.method === "PATCH" && request.url.includes("loyaltyClass/")), false);
});

test("a class patch failure prevents a new save link and object balance writes", async () => {
  const { provider, state } = harness({ hook: request => request.init.method === "PATCH" && request.url.includes("loyaltyClass/")
    ? jsonResponse(400, { private: snapshot.customer_name }) : undefined });
  await provider.savePass(snapshot);
  await assert.rejects(provider.savePass({ ...snapshot, business_name: "Café del Parque", points: 130 }), {
    code: "GOOGLE_WALLET_HTTP_ERROR", status: 400, message: "Google Wallet request failed (HTTP 400)."
  });
  assert.equal(state.objects.get(objectId).loyaltyPoints.balance.int, snapshot.points);
});

test("updates synchronize names and mark revoked passes inactive", async () => {
  const { provider, state } = harness();
  await provider.savePass(snapshot);
  const result = await provider.updatePass({ ...snapshot, points: 0, customer_name: "María", revoked_at: "2026-11-09T12:01:00Z", revision: 9 });
  assert.equal(result, undefined);
  const object = state.objects.get(objectId);
  assert.equal(object.accountName, "Tarjeta desactivada");
  assert.equal(object.state, "INACTIVE");
  assert.deepEqual(object.loyaltyPoints.balance, { int: 0 });
});

test("missing names do not become undefined or null strings on a new pass", async () => {
  const { provider, state } = harness();
  await provider.savePass({ ...snapshot, customer_name: null });
  assert.equal(state.objects.get(objectId).accountName, "Cliente");
});

test("update heals a missing object after an interrupted issuance", async () => {
  const { provider, state } = harness();
  await provider.updatePass(snapshot);
  assert.deepEqual(state.objects.get(objectId).loyaltyPoints.balance, { int: 125 });
});

test("token refresh honors Google expiry and caps a longer expiry at one hour", async () => {
  for (const expiresIn of [300, 7200]) {
    const { provider, state } = harness({ expiresIn });
    await provider.savePass(snapshot);
    state.time += (Math.min(expiresIn, 3600) - 61) * 1000;
    await provider.updatePass(snapshot);
    assert.equal(state.tokens, 1);
    state.time += 2000;
    await provider.updatePass(snapshot);
    assert.equal(state.tokens, 2);
  }
});

test("concurrent saves share token refresh and recover real class and object insertion conflicts", async () => {
  const waiting = new Map();
  const { provider, state } = harness({ hook: request => {
    if (request.init.method !== "GET") return;
    if (!waiting.has(request.url)) {
      return new Promise(resolve => { waiting.set(request.url, resolve); });
    }
    const release = waiting.get(request.url);
    if (release) {
      waiting.set(request.url, null);
      release(jsonResponse(404, {}));
      return jsonResponse(404, {});
    }
  } });
  const links = await Promise.all([provider.savePass(snapshot), provider.savePass(snapshot)]);
  assert.equal(links.length, 2);
  assert.equal(state.tokens, 1);
  assert.equal(state.classes.size, 1);
  assert.equal(state.objects.size, 1);
  assert.ok(state.requests.filter(request => request.init.method === "POST" && request.url.endsWith("loyaltyClass")).length >= 2);
  assert.ok(state.requests.filter(request => request.init.method === "POST" && request.url.endsWith("loyaltyObject")).length >= 2);
});

test("409 is accepted only after reading a matching object back", async () => {
  const { provider, state } = harness({ hook: request => request.init.method === "POST" && request.url.endsWith("loyaltyObject") ? jsonResponse(409, { secret: "must not leak" }) : undefined });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_HTTP_ERROR", status: 404 });
  assert.equal(state.objects.size, 0);
});

test("an object conflict cannot reassign a pass belonging to another business", async () => {
  const { provider, state } = harness({ hook: (request, current) => {
    if (request.init.method === "POST" && request.url.endsWith("loyaltyObject")) {
      current.objects.set(objectId, { id: objectId, classId: `${config.issuerId}.other_business` });
      return jsonResponse(409, {});
    }
  } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_RESOURCE_MISMATCH" });
  assert.equal(state.requests.some(request => request.init.method === "PATCH"), false);
});

test("class conflicts validate the resource identifier before continuing", async () => {
  const { provider, state } = harness({ hook: (request, current) => {
    if (request.init.method === "POST" && request.url.endsWith("loyaltyClass")) {
      current.classes.set(classId, { id: "other-issuer.other-class" });
      return jsonResponse(409, {});
    }
  } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_RESOURCE_MISMATCH" });
  assert.equal(state.objects.size, 0);
});

test("HTTP failures expose only status and a stable code without upstream bodies", async () => {
  const { provider } = harness({ hook: request => request.url !== tokenUrl ? jsonResponse(403, { private_key: config.privateKey, customer: snapshot.customer_name }) : undefined });
  await assert.rejects(provider.savePass(snapshot), error => {
    assert.ok(error instanceof Error);
    assert.equal("code" in error && error.code, "GOOGLE_WALLET_HTTP_ERROR");
    assert.equal("status" in error && error.status, 403);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.message, /PRIVATE KEY|María|test-token/);
    return true;
  });
});

test("network errors and malformed OAuth responses are sanitized and can be retried", async () => {
  let failures = 0;
  const { provider } = harness({ hook: request => {
    if (request.url === tokenUrl && failures++ === 0) throw new Error(`secret ${config.privateKey}`);
  } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_REQUEST_FAILED", message: "Google Wallet request failed." });
  assert.ok(await provider.savePass(snapshot));
  const invalid = harness({ hook: request => request.url === tokenUrl ? jsonResponse(200, { access_token: "private-token", expires_in: "not-a-number" }) : undefined });
  await assert.rejects(invalid.provider.savePass(snapshot), { code: "GOOGLE_WALLET_INVALID_RESPONSE" });
});

test("a stalled request is aborted after the bounded timeout", async t => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    assert.equal(delay, 10000);
    return originalSetTimeout(callback, 1, ...args);
  });
  /** @type {AbortSignal | undefined} */
  let signal;
  const { provider } = harness({ hook: request => {
    signal = request.init.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_TIMEOUT" });
  assert.ok(signal);
  assert.equal(signal.aborted, true);
});

test("invalid configuration and identifiers fail without making network requests", async () => {
  for (const changed of [{ issuerId: "../foreign" }, { serviceAccountEmail: "not-a-service-account" }, { appOrigin: "http://localhost" }, { logoUrl: "https://127.0.0.1/logo.png" }]) {
    assert.throws(() => harness({ config: { ...config, ...changed } }), { code: "GOOGLE_WALLET_INVALID_CONFIG" });
  }
  const { provider, state } = harness();
  for (const changed of [{ id: "../foreign" }, { business_id: "" }, { points: NaN }, { pending_points: -1 }, { barcode: "" }]) {
    await assert.rejects(provider.savePass({ ...snapshot, ...changed }), { code: "GOOGLE_WALLET_INVALID_SNAPSHOT" });
  }
  assert.equal(state.requests.length, 0);
});

test("the dedicated public logo meets Google's recommended minimum size and is the fallback", async () => {
  const { provider, state } = harness({ config: { ...config, logoUrl: undefined, privateKeyId: undefined } });
  await provider.savePass(snapshot);
  assert.equal(state.classes.get(classId).programLogo.sourceUri.uri, `${config.appOrigin}/images/wallet/google-logo.png`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository branding asset.
  const logo=await readFile(new URL('../../public/images/wallet/google-logo.png',import.meta.url));
  assert.equal(logo.subarray(1,4).toString(),'PNG');
  const width=logo.readUInt32BE(16);
  const height=logo.readUInt32BE(20);
  assert.ok(width>=660);
  assert.equal(width,height);
});

test("a rejected bearer token is discarded so the next attempt refreshes credentials", async () => {
  let rejected = false;
  const { provider, state } = harness({ hook: request => {
    if (request.url !== tokenUrl && !rejected) {
      rejected = true;
      return jsonResponse(401, { message: "credential detail must not escape" });
    }
  } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_HTTP_ERROR", status: 401 });
  await provider.savePass(snapshot);
  assert.equal(state.tokens, 2);
});

test("invalid OAuth token types are reported as sanitized response errors", async () => {
  const { provider } = harness({ hook: request => request.url === tokenUrl
    ? jsonResponse(200, { access_token: "secret-token", expires_in: 3600, token_type: 123 }) : undefined });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_INVALID_RESPONSE" });
});

test("invalid private key material never reaches the network or error text", async () => {
  const { provider, state } = harness({ config: { ...config, privateKey: "-----BEGIN PRIVATE KEY-----\nsecret-invalid-material\n-----END PRIVATE KEY-----" } });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_SIGNING_FAILED", message: "Google Wallet signing failed." });
  assert.equal(state.requests.length, 0);
});

test("malformed successful JSON cannot produce a save link", async () => {
  const { provider } = harness({ hook: request => request.url !== tokenUrl ? new Response("secret-not-json", { status: 200 }) : undefined });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_INVALID_RESPONSE", message: "Google Wallet returned an invalid response." });
});

test("the request timeout also bounds a stalled response body", async t => {
  const originalSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    assert.equal(delay, 10000);
    return originalSetTimeout(callback, 1, ...args);
  });
  const { provider } = harness({ hook: () => new Response(new ReadableStream({ start() {} }), { status: 200 }) });
  await assert.rejects(provider.savePass(snapshot), { code: "GOOGLE_WALLET_TIMEOUT" });
});

test('revocation clears the previously saved customer name and balance', async()=>{
  const {provider,state}=harness();
  await provider.savePass(snapshot);
  await provider.updatePass({...snapshot,revoked_at:new Date(),customer_name:null});
  const object=state.objects.get(objectId);
  assert.equal(object.state,'INACTIVE');
  assert.equal(object.accountName,'Tarjeta desactivada');
  assert.equal(object.loyaltyPoints.balance.int,0);
});

test('Google enrichment adds concise progress and scoped object locations, then explicitly clears them on revocation',async()=>{
 const {provider,state}=harness();
 const wallet_engagement={usage:'Los puntos pendientes aún no se pueden canjear.',progress:'Te faltan 25 puntos para Café.',earning:'2 puntos por GTQ 1.',conditions:'Canje en: Centro.',locations:[{name:'Centro',latitude:14.6,longitude:-90.5}]};
 await provider.savePass({...snapshot,wallet_engagement});
 let object=state.objects.get(objectId);
 assert.equal(object.textModulesData.find(row=>row.id==='reward_progress').body,wallet_engagement.progress);
 assert.equal(object.textModulesData.find(row=>row.id==='card_usage').body,wallet_engagement.usage);
 assert.deepEqual(object.merchantLocations,[{latitude:14.6,longitude:-90.5}]);
 assert.equal(object.linksModuleData.uris[0].uri,`${config.appOrigin}/mi-tarjeta/`);
 assert.equal(state.classes.get(classId).merchantLocations,undefined,'customer scope must never alter the shared class');
 assert.equal(object.notifyPreference,undefined);assert.equal(object.messages,undefined);
 await provider.updatePass({...snapshot,is_voided:true,wallet_engagement});
 object=state.objects.get(objectId);assert.equal(object.state,'INACTIVE');assert.deepEqual(object.textModulesData,[]);assert.deepEqual(object.merchantLocations,[]);assert.equal(object.loyaltyPoints.balance.int,0);
});

test('Google keeps a refund-negative signed available balance instead of failing every refresh',async()=>{
 const {provider,state}=harness();
 await provider.savePass({...snapshot,points:-20});
 assert.equal(state.objects.get(objectId).loyaltyPoints.balance.int,-20);
 await provider.updatePass({...snapshot,points:-2147483648});
 assert.equal(state.objects.get(objectId).loyaltyPoints.balance.int,-2147483648);
 await assert.rejects(provider.updatePass({...snapshot,points:-2147483649}),{code:'GOOGLE_WALLET_INVALID_SNAPSHOT'});
});
