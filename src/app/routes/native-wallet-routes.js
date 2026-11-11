import { Router } from 'express';
import { asyncRoute } from '../../middleware/common.js';
import { requireCustomer } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { rateLimitByIp } from '../../middleware/rate-limit.js';
import { badRequest, notFound, tooManyRequests } from '../../utils/http-error.js';
import { nativeWalletService, walletSettings, walletGlobalContext } from '../services/native-wallet/runtime.js';
import { NativeWalletRepo } from '../repositories/native-wallet-repository.js';

const opaque = /^[A-Za-z0-9_-]{8,256}$/;
const serial = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = (_req,res,next)=>{res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});next();};
// End explicitly: res.send re-evaluates date validators at whole-second precision
// and could suppress a newer pass revision produced during that same second.
const sendPass = (res,bytes)=>res.set({'Content-Type':'application/vnd.apple.pkpass','Content-Disposition':'attachment; filename="PuntosFieles.pkpass"','Content-Length':String(bytes.length)}).end(bytes);

export function createNativeWalletRoutes({service=nativeWalletService,repo=NativeWalletRepo,settings=walletSettings,globalContext=walletGlobalContext,customerAuth=/** @type {import("express").RequestHandler} */(requireCustomer),tenant=/** @type {import("express").RequestHandler} */(tenantContext),csrf=/** @type {import("express").RequestHandler} */(csrfProtect)}={}) {
  const router=Router();
  router.use(['/customer/wallet','/wallet/apple'],noStore);
  const customer=[customerAuth,tenant];
  router.get('/customer/wallet',...customer,asyncRoute(async(req,res)=>res.json(await service.status(req.customerAuth))));
  router.post('/customer/wallet/revoke',csrf,...customer,asyncRoute(async(req,res)=>res.json(await service.revoke(req.customerAuth))));
  router.post('/customer/wallet/:provider',csrf,...customer,rateLimitByIp(20,60000,{keyPrefix:'ip:wallet-issue:'}),asyncRoute(async(req,res)=>{
    if (!['apple','google'].includes(req.params.provider)) throw notFound();
    res.json(await service.issue(req.customerAuth,req.params.provider));
  }));
  router.get('/customer/wallet/apple/download',...customer,asyncRoute(async(req,res)=>sendPass(res,await service.downloadApple(req.customerAuth))));
  router.use('/wallet/apple',rateLimitByIp(120,60000,{keyPrefix:'ip:wallet-apple:'}),(_req,_res,next)=>{
    try{service.requireProvider('apple');next();}catch(e){next(e);}
  });
  const prefix='/wallet/apple/v1';
  async function authenticated(req) {
    if (!serial.test(req.params.serial)) throw notFound();
    return service.authenticateApple(req.params.passType,req.params.serial,req.get('Authorization'));
  }
  const registration=`${prefix}/devices/:device/registrations/:passType/:serial`;
  router.post(registration,asyncRoute(async(req,res)=>{
    const pass=await authenticated(req);
    if (!opaque.test(req.params.device) || typeof req.body?.pushToken!=='string' || !/^[0-9a-f]{32,256}$/i.test(req.body.pushToken)) throw badRequest('Invalid registration');
    let registered;
    try { registered=await globalContext(()=>repo.registerDevice({passId:pass.id,deviceId:req.params.device,pushToken:req.body.pushToken})); }
    catch(e) { if(e?.constraint==='native_wallet_device_limit') throw tooManyRequests('Device registration limit reached'); throw e; }
    res.sendStatus(registered?.created?201:200);
  }));
  router.delete(registration,asyncRoute(async(req,res)=>{
    const pass=await authenticated(req);
    if (!opaque.test(req.params.device)) throw badRequest('Invalid device');
    await globalContext(()=>repo.unregisterDevice(pass.id,req.params.device));
    res.sendStatus(200);
  }));
  router.get(`${prefix}/devices/:device/registrations/:passType`,asyncRoute(async(req,res)=>{
    if (req.params.passType!==settings.apple.config.passTypeIdentifier || !opaque.test(req.params.device)) throw notFound();
    const since=req.query.passesUpdatedSince;
    if (since!==undefined && (typeof since!=='string' || !/^\d{1,19}$/.test(since) || BigInt(since)>9223372036854775807n)) throw badRequest('Invalid update tag');
    const updates=await globalContext(()=>repo.getDeviceUpdates(req.params.device,'apple',since??null));
    if (!updates.serial_numbers.length) return res.status(204).end();
    res.json({serialNumbers:updates.serial_numbers,lastUpdated:updates.last_updated});
  }));
  router.get(`${prefix}/passes/:passType/:serial`,asyncRoute(async(req,res)=>{
    const pass=await authenticated(req);
    const updated=await service.updatedApplePass(pass);
    const etag=`"wallet-${updated.revision}"`;
    res.set('ETag',etag);
    const modifiedAt=updated.updatedAt?new Date(updated.updatedAt).getTime():NaN;
    if (Number.isFinite(modifiedAt)) res.set('Last-Modified',new Date(modifiedAt).toUTCString());
    const matches=req.get('If-None-Match');
    if (matches!==undefined) {
      // Entity tags take precedence over dates; GET uses weak comparison.
      if (matches.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag)) return res.status(304).end();
    }
    // Date-only validators cannot identify a revision: changes can share a
    // second, and database transaction timestamps can precede earlier commits.
    // Return the pass conservatively unless its exact revision tag matched.
    sendPass(res,updated.bytes);
  }));
  router.post(`${prefix}/log`,(req,res,next)=>{
    if (!Array.isArray(req.body?.logs) || req.body.logs.length>50 || req.body.logs.some(log=>typeof log!=='string'||log.length>1000)) return next(badRequest('Invalid log envelope'));
    // Apple diagnostics may contain tokens or pass content. Accept without retaining.
    res.sendStatus(200);
  });
  return router;
}
export const nativeWalletRoutes=createNativeWalletRoutes();
