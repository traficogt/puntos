import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { loadNativeWalletConfig } from '../../src/app/services/native-wallet/config.js';
import { createGoogleProvider } from '../../src/app/services/native-wallet/google.js';

test('wallets are disabled without reading files or contacting providers', () => {
  const cfg = loadNativeWalletConfig({}, { readFile: () => { throw Error('must not read'); } });
  assert.equal(cfg.apple.ready, false); assert.equal(cfg.google.ready, false);
  assert.equal(cfg.apple.enabled, false); assert.equal(cfg.google.enabled, false);
});
test('enabled incomplete provider fails closed with variable names, never values', () => {
  const cfg = loadNativeWalletConfig({ APPLE_WALLET_ENABLED: 'true', APP_ORIGIN: 'http://private.test', APPLE_WALLET_PRIVATE_KEY_FILE: '/secret/location' });
  assert.equal(cfg.apple.ready, false);
  assert.ok(cfg.apple.errors.includes('APP_ORIGIN_HTTPS_REQUIRED'));
  assert.ok(!JSON.stringify(cfg.apple.errors).includes('/secret/location'));
});
test('Google validates service account key and constrains public destinations', () => {
  const {privateKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const account = JSON.stringify({type:'service_account',client_email:'wallet@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  const env = { GOOGLE_WALLET_ENABLED:'true', APP_ORIGIN:'https://app.puntosfieles.com', GOOGLE_WALLET_ISSUER_ID:'123456789', GOOGLE_WALLET_SERVICE_ACCOUNT_FILE:'/private/key.json' };
  const cfg = loadNativeWalletConfig(env,{readFile:()=>account});
  assert.equal(cfg.google.ready,true); assert.equal(cfg.google.config.issuerId,'123456789');
  assert.equal(cfg.google.config.logoUrl,'https://app.puntosfieles.com/images/wallet/google-logo.png');
  assert.equal(loadNativeWalletConfig({...env,GOOGLE_WALLET_ISSUER_ID:'../bad'},{readFile:()=>account}).google.ready,false);
  assert.equal(loadNativeWalletConfig({...env,GOOGLE_WALLET_LOGO_URL:'http://localhost/a'},{readFile:()=>account}).google.ready,false);
});
test('Google preflight rejects destinations that runtime cannot initialize',()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const account=JSON.stringify({type:'service_account',client_email:'wallet@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  const env={GOOGLE_WALLET_ENABLED:'true',APP_ORIGIN:'https://app.example.com',GOOGLE_WALLET_ISSUER_ID:'123',GOOGLE_WALLET_SERVICE_ACCOUNT_FILE:'unused-test-fixture'};
  for(const origin of ['https://branding.internal','https://branding.local','https://branding.test','https://branding.invalid','https://10.0.0.5','https://[2001:db8::1]','https://singlehost']) {
    assert.equal(loadNativeWalletConfig({...env,GOOGLE_WALLET_LOGO_URL:`${origin}/logo.png`},{readFile:()=>account}).google.ready,false,origin);
    assert.equal(loadNativeWalletConfig({...env,APP_ORIGIN:origin},{readFile:()=>account}).google.ready,false,origin);
  }
  const ready=loadNativeWalletConfig({...env,GOOGLE_WALLET_LOGO_URL:'https://cdn.example.com/logo.png?version=2'},{readFile:()=>account}).google;
  assert.equal(ready.ready,true);
  assert.doesNotThrow(()=>createGoogleProvider(ready.config,{fetchImpl:async()=>{throw Error('No network permitted');}}));
});
test('Google preflight rejects non-PKCS8 keys that the signing adapter cannot import',()=>{
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const account=JSON.stringify({type:'service_account',client_email:'wallet@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs1',format:'pem'})});
  const cfg=loadNativeWalletConfig({GOOGLE_WALLET_ENABLED:'true',APP_ORIGIN:'https://app.example.com',GOOGLE_WALLET_ISSUER_ID:'123',GOOGLE_WALLET_SERVICE_ACCOUNT_FILE:'unused-test-fixture'},{readFile:()=>account});
  assert.equal(cfg.google.ready,false);
  assert.deepEqual(cfg.google.errors,['GOOGLE_WALLET_SERVICE_ACCOUNT_INVALID_OR_UNAVAILABLE']);
});
test('unreadable or malformed credentials produce only safe diagnostics', () => {
  const cfg = loadNativeWalletConfig({GOOGLE_WALLET_ENABLED:'true',APP_ORIGIN:'https://app.example.com',GOOGLE_WALLET_ISSUER_ID:'123',GOOGLE_WALLET_SERVICE_ACCOUNT_FILE:'/private/key'},{readFile:()=>{throw Error('sensitive');}});
  assert.equal(cfg.google.ready,false); assert.ok(!JSON.stringify(cfg.google).includes('sensitive'));
});
