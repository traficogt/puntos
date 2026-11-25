let version=0,sources=[];
const stamp=()=>String(version).padStart(64,'0');
// Ledger corrections moved to demo-owner-operations.ts (richer rows shared with the ledger screen).
export async function demoEvidenceHealth(url,options={}){
 const method=options.method??'GET',body=options.body?JSON.parse(options.body):{};
 if(url.pathname==='/api/admin/data-health'){
  if(method==='PUT'){if(body.version!==stamp())throw Object.assign(new Error('Actualiza la configuración antes de guardar.'),{status:409});sources=body.sources;version++;return {ok:true,version:stamp(),sources};}
  return {version:stamp(),sources,branches:[{id:'22222222-2222-4222-8222-222222222222',name:'Sucursal de ejemplo'}],events:[],heartbeat_path:'/api/public/pos/negocio-de-ejemplo/health/heartbeat',readiness:{state:sources.some(s=>s.enabled)?'blocked':'recorded_only',summary:sources.some(s=>s.enabled)?'Ejemplo: la conexión todavía no ha confirmado una ventana de datos.':'Ejemplo: el análisis usa los registros disponibles; no hay conexiones monitoreadas.',sources:sources.filter(s=>s.enabled).map(s=>({...s,state:'blocked',summary:'Sin confirmación de sincronización en esta demostración.',coverage_through:null,received_at:null}))}};
 }
 if(url.pathname==='/api/admin/transaction-rejections')return {attempts:[{id:'eeeeeeee-eeee-4eee-8eee-000000000001',customer_name:'Cliente de ejemplo',reward_name:'Recompensa de ejemplo',created_at:'2026-11-13T18:00:00Z',reason:'La recompensa no estaba disponible en la sucursal seleccionada.',status:'open'}],note:'Intento ficticio. No representa un débito de puntos ni un problema de un cliente real.'};
 throw Object.assign(new Error('Ruta de ejemplo no disponible.'),{status:404});
}
