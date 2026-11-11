import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dbQuery, withTransaction } from '../database.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';
const rateKey = {SPEND:'points_per_q',VISIT:'points_per_visit',ITEM:'points_per_item'};
export const LaunchProgramInput = z.object({
 program_type:z.enum(['SPEND','VISIT','ITEM']),rate:z.number().finite().positive().max(10000),
 round:z.enum(['ceil','round','floor']),version:z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine(v=>v.program_type==='SPEND'?Math.abs(v.rate*10000-Math.round(v.rate*10000))<0.000001:Number.isInteger(v.rate),{message:'Usa hasta cuatro decimales por quetzal y puntos enteros por visita o artículo.',path:['rate']});
export function programBasics(business) {
 const config=business.program_json ?? {}, type=business.program_type ?? 'SPEND';
 const basics={program_type:type,points_per_q:config.points_per_q ?? 0.1,points_per_visit:config.points_per_visit ?? 10,points_per_item:config.points_per_item ?? 1,round:config.round ?? 'ceil'};
 const version=createHash('sha256').update(JSON.stringify(basics)).digest('hex');
 const raw=basics[rateKey[type]],rate=Number(raw);
 return {program_type:type,rate:Number.isFinite(rate)?rate:null,round:basics.round,version};
}
export async function getLaunchProgram({businessId},query=dbQuery){
 const {rows}=await query('SELECT program_type,program_json FROM businesses WHERE id=$1',[businessId]);
 if(!rows[0])throw notFound('Negocio no encontrado.');
 return {ok:true,program:programBasics(rows[0])};
}
export async function updateLaunchProgram(options,injected={}){
 const parsed=LaunchProgramInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa la regla de puntos.');
 const d={transaction:withTransaction,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),...injected};
 const overrides=await d.getPlanFeatureOverrides(),input=parsed.data;
 return d.transaction(async client=>{
  const {rows}=await client.query('SELECT id,plan,program_type,program_json FROM businesses WHERE id=$1 FOR NO KEY UPDATE',[options.businessId]);
  const business=rows[0];if(!business)throw notFound('Negocio no encontrado.');
  if(!hasPlanFeature(business.plan,'program_rules',overrides))throw forbidden('Tu plan no permite editar el programa.');
  const before=programBasics(business);if(before.version!==input.version)throw conflict('La regla cambió en otra sesión. Recarga la configuración antes de guardar.');
  const patch={[rateKey[input.program_type]]:input.rate,...(input.program_type==='SPEND'?{round:input.round}:{})};
  const updated=await client.query("UPDATE businesses SET program_type=$2,program_json=COALESCE(program_json,'{}'::jsonb)||$3::jsonb WHERE id=$1 RETURNING program_type,program_json",[options.businessId,input.program_type,JSON.stringify(patch)]);
  const after=programBasics(updated.rows[0]);
  await client.query(`INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta) VALUES($1,$2,'STAFF',$3,'program.launch.basics.update',$4,$5,$6)`,[randomUUID(),options.businessId,options.staffId,options.ip??null,options.ua??null,JSON.stringify(withImpersonationMeta({before,after},options))]);
  return {ok:true,program:after};
 });
}
