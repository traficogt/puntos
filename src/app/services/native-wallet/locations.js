import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {withTransaction} from '../../database.js';
import {many} from '../../repositories/base.js';
import {badRequest,conflict,forbidden,notFound} from '../../../utils/http-error.js';
import {withImpersonationMeta} from '../../../utils/impersonation.js';
export const WalletLocationSchema=z.object({enabled:z.boolean(),latitude:z.number().finite().min(-90).max(90).nullable(),longitude:z.number().finite().min(-180).max(180).nullable()}).strict().refine(v=>(v.latitude===null)===(v.longitude===null)&&(!v.enabled||v.latitude!==null),{message:'Ingresa ambas coordenadas válidas para activar la ubicación.'});
export const WalletLocationService={
 async list({businessId}){
  const branches=await many('SELECT id,name,address,wallet_location_enabled,wallet_latitude,wallet_longitude FROM branches WHERE business_id=$1 ORDER BY name,id',[businessId]);
  return {ok:true,branches,maximum_locations:10};
 },
 async save({businessId,branchId,staff,location},injected={}){
  const checked=WalletLocationSchema.safeParse(location);if(!checked.success)throw badRequest('Revisa la latitud, longitud y activación de la ubicación.');
  if(staff?.business_id!==businessId)throw forbidden('La sesión no pertenece a este negocio.');
  return (injected.transaction??withTransaction)(async client=>{
   // Serialize the ten-location budget for simultaneous edits across branches.
   await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
   const owner=(await client.query("SELECT id FROM staff_users WHERE id=$1 AND business_id=$2 AND role='OWNER' AND active FOR SHARE",[staff.id,businessId])).rows[0];
   if(!owner)throw forbidden('Solo el dueño puede configurar ubicaciones de Wallet.');
   const branch=(await client.query('SELECT id FROM branches WHERE id=$1 AND business_id=$2 FOR UPDATE',[branchId,businessId])).rows[0];if(!branch)throw notFound('Sucursal no encontrada.');
   if(checked.data.enabled){const count=(await client.query('SELECT count(*)::int AS count FROM branches WHERE business_id=$1 AND id<>$2 AND wallet_location_enabled',[businessId,branchId])).rows[0].count;if(count>=10)throw conflict('Puedes activar hasta diez ubicaciones. Desactiva otra sucursal antes de continuar.');}
   const {enabled,latitude,longitude}=checked.data;
   const saved=(await client.query('UPDATE branches SET wallet_location_enabled=$3,wallet_latitude=$4,wallet_longitude=$5 WHERE id=$1 AND business_id=$2 RETURNING id,name,address,wallet_location_enabled,wallet_latitude,wallet_longitude',[branchId,businessId,enabled,latitude,longitude])).rows[0];
   await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,'wallet.branch.location.update',$4)",[randomUUID(),businessId,staff.id,withImpersonationMeta({branch_id:branchId,enabled,latitude,longitude},staff)]);
   return {ok:true,branch:saved};
  });
 }
};
