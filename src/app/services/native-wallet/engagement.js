import {businessRegion} from '../regional-settings.js';
const text=value=>String(value??'').trim().slice(0,160);
const positive=value=>Math.max(0,Math.floor(Number(value)||0));
const number=value=>new Intl.NumberFormat('es',{maximumFractionDigits:20}).format(value);

/** Select one points-based choice; pending points and hospitality never inflate progress. */
export function buildWalletEngagement(snapshot) {
 const empty={reward:null,progress:null,earning:null,conditions:null,usage:null,locations:[],next_refresh_at:null};
 if(snapshot.is_voided||snapshot.revoked_at)return empty;
 const now=new Date(snapshot.snapshot_at??Date.now()).getTime(),points=Number(snapshot.points)||0;
 const branches=Array.isArray(snapshot.wallet_branches)?snapshot.wallet_branches:[];
 const branchIds=new Set(branches.map(b=>b.id));
 const guard=snapshot.program_json?.redemption_guard??{};
 const daily=positive(guard.max_redemptions_per_day),perReward=positive(guard.max_reward_redemptions_per_day),cooldown=positive(guard.reward_cooldown_hours);
 const deadlines=[];
 const later=value=>{const at=new Date(value).getTime();if(Number.isFinite(at)&&at>now)deadlines.push(at);};
 const dailyBlocked=daily>0&&positive(snapshot.wallet_daily_redemptions)>=daily;
 if(dailyBlocked)later(snapshot.wallet_next_day);
 const candidates=(snapshot.wallet_rewards??[]).filter(r=>{
  if(r.valid_until)later(r.valid_until);
  const dayBlocked=perReward>0&&positive(r.daily_count)>=perReward;
  const cooldownUntil=r.last_redeemed_at?new Date(r.last_redeemed_at).getTime()+cooldown*3600000:0;
  if(dayBlocked)later(snapshot.wallet_next_day);
  if(cooldown&&cooldownUntil>now)later(cooldownUntil);
  return (r.promise_id||r.active)&&r.available!==false&&(r.stock==null||Number(r.stock)>0)
   &&(!r.valid_until||new Date(r.valid_until).getTime()>now)
   &&Number.isInteger(Number(r.points_cost))&&Number(r.points_cost)>=0
   &&(!(r.branch_ids?.length)||r.branch_ids.some(id=>branchIds.has(id)))
   &&!dailyBlocked&&!dayBlocked&&!(cooldown&&cooldownUntil>now);
 }).sort((a,b)=>Number(a.points_cost)-Number(b.points_cost)||String(a.id).localeCompare(String(b.id)));
 const selected=candidates[0];
 const reward=selected?{id:selected.id,name:text(selected.reward_name??selected.name),points_cost:Number(selected.points_cost),remaining_points:Math.max(0,Number(selected.points_cost)-points),status:Number(selected.points_cost)<=points?'available':'progress',protected:Boolean(selected.promise_id),branch_ids:selected.branch_ids??[],valid_until:selected.valid_until??null}:null;
 const terms=snapshot.wallet_cycle?.earning_terms??snapshot.program_json??{};
 const type=snapshot.wallet_cycle?.program_type??snapshot.program_type;
 const rate=Number(type==='SPEND'?terms.points_per_q??0.1:type==='VISIT'?terms.points_per_visit??10:terms.points_per_item??1);
 const region=businessRegion({program_json:snapshot.program_json});
 // Older protected cycles predate regional settings. Preserve their earning
 // rules, but only override the business currency when the cycle recorded one.
 const currency=businessRegion({program_json:{region:{...region,...terms.region}}}).currency;
 const rounding=terms.round==='floor'?'hacia abajo':terms.round==='round'?'al entero más cercano':'hacia arriba';
 const earning=Number.isFinite(rate)&&rate>=0?`${snapshot.wallet_cycle?'Condiciones protegidas: ':''}${number(rate)} puntos ${type==='SPEND'?`por ${currency} 1`:type==='VISIT'?'por visita':'por artículo'}.${type==='SPEND'?` Redondeo ${rounding}.`:''}`:null;
 const scoped=reward?.branch_ids?.length?branches.filter(b=>reward.branch_ids.includes(b.id)):branches;
 const seen=new Set();
 const locations=scoped.filter(b=>{
  if(!b.wallet_location_enabled||typeof b.wallet_latitude!=='number'||typeof b.wallet_longitude!=='number'||!Number.isFinite(b.wallet_latitude)||!Number.isFinite(b.wallet_longitude)||Math.abs(b.wallet_latitude)>90||Math.abs(b.wallet_longitude)>180)return false;
  const key=`${b.wallet_latitude},${b.wallet_longitude}`;if(seen.has(key))return false;seen.add(key);return true;
 }).slice(0,10).map(b=>({branch_id:b.id,name:text(b.name),latitude:b.wallet_latitude,longitude:b.wallet_longitude}));
 const branchNames=reward?.branch_ids?.length?branches.filter(b=>reward.branch_ids.includes(b.id)).map(b=>text(b.name)):[];
 const expiry=reward?.valid_until?new Intl.DateTimeFormat(region.locale,{dateStyle:'long',timeStyle:'short',timeZone:region.timezone}).format(new Date(reward.valid_until)):null;
 const conditions=reward?[reward.protected?'Condiciones originales protegidas.':'',branchNames.length?`Canje en: ${branchNames.join(', ')}.`:'Canje en las sucursales del negocio.',expiry?`Vigencia: ${expiry} (${region.timezone}).`:'','Sujeto a disponibilidad al canjear.'].filter(Boolean).join(' '):null;
 const usage='Los puntos pendientes aún no se pueden canjear. Puedes mostrar este QR sin conexión; para actualizar saldos y recompensas necesitas conectarte. Confirma el canje en caja.';
 return {reward,progress:reward?(reward.status==='available'?`Puedes elegir ${reward.name} por ${number(reward.points_cost)} puntos.`:`Te faltan ${number(reward.remaining_points)} puntos para ${reward.name}.`):'Consulta las recompensas y su disponibilidad en tu cuenta.',earning,conditions,usage,locations,next_refresh_at:deadlines.length?new Date(Math.min(...deadlines)).toISOString():null};
}
