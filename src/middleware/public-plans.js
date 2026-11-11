import {normalizeHostHeader} from '../utils/app-host-routing.js';
import {Router} from 'express';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {PlanConfigService} from '../app/services/plan-config-service.js';
import {publicPlanCatalog,renderPlanComparison} from '../app/services/public-plan-service.js';
export function createPublicPlans({publicDir,marketingOrigin=null,appOrigin=null,listPlans=()=>PlanConfigService.listPlans()}){
 const router=Router({strict:true});
 router.use(['/precios','/precios/','/precios.html'],(req,res,next)=>{
  if(marketingOrigin&&appOrigin&&marketingOrigin!==appOrigin&&normalizeHostHeader(req.get('host'))===normalizeHostHeader(new URL(appOrigin).host))return res.redirect(301,new URL('/precios',marketingOrigin).toString()+new URL(req.originalUrl,'http://localhost').search);
  return next();
 });
 router.get(['/precios/','/precios.html'],(_req,res)=>res.redirect(301,'/precios'));
 router.get('/precios',async(_req,res,next)=>{try{
  const catalog=publicPlanCatalog(await listPlans());
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed template beneath the configured public directory.
  const html=await readFile(path.join(publicDir,'precios.html'),'utf8');
  res.set('Cache-Control','no-store').type('html').send(html.replace('<!--PLAN_COMPARISON-->',renderPlanComparison(catalog)));
 }catch(error){next(error);}});return router;
}
