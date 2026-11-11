const businessId='11111111-1111-4111-8111-111111111111';
const branches=[{id:'22222222-2222-4222-8222-222222222222',name:'Zona 10 · ejemplo'}];
const definitions={
  period:'Acumulado desde la creación de cada origen.',
  visits:'Aperturas del enlace registradas; no son escaneos ni personas únicas. Recargas y visitas automatizadas pueden contar.',
  registrations:'Clientes nuevos con teléfono verificado y un enlace visitado en los 30 minutos anteriores. Se conserva el primer origen; los accesos de clientes existentes no cuentan.',
  purchases:'Clientes atribuidos con al menos una compra registrada; recurrentes con dos o más. Incluye compras POSTED y PENDING, excluye compras anuladas y movimientos de bono.',
  sales:'Importes registrados de clientes atribuidos desde su inscripción, en GTQ. Son ventas observadas, no ingresos causados por el QR ni ganancia. Devoluciones parciales o pendientes de conciliación pueden seguir incluidas.',
  deletion:'Las altas históricas se conservan sin datos personales. Compradores y ventas excluyen clientes eliminados; estos totales pueden bajar.'
};
const link='https://puntosfieles.com/demostracion#marca';
let sources=[
  {id:'33333333-3333-4333-8333-333333333333',business_id:businessId,name:'Mostrador · ejemplo',code:'demoMostrador001',branch_id:branches[0].id,branch_name:branches[0].name,registration_url:link,visits:124,registrations:32,active_customers:32,first_purchasers:21,repeat_purchasers:9,recorded_sales_q:1475},
  {id:'44444444-4444-4444-8444-444444444444',business_id:businessId,name:'Mesas · ejemplo',code:'demoMesa00000001',branch_id:null,branch_name:null,registration_url:link,visits:76,registrations:18,active_customers:18,first_purchasers:12,repeat_purchasers:4,recorded_sales_q:830}
];
const requests=new Map();
export function demoAcquisitionSources(){return structuredClone(sources);}
export function demoAcquisition(url,options={}){
  const method=options.method||'GET';
  if(method==='GET' && ['/api/admin/acquisition','/api/admin/acquisition/sources'].includes(url.pathname))return {ok:true,sources:demoAcquisitionSources(),branches:structuredClone(branches),limit:100,definitions:{...definitions}};
  if(method==='POST' && url.pathname==='/api/admin/acquisition/sources'){
    const body=JSON.parse(options.body||'{}');
    if(Object.keys(body).some(k=>!['name','branch_id','request_id'].includes(k)) || typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>80 || !/^[\da-f-]{36}$/i.test(body.request_id||'') || (body.branch_id && !branches.some(b=>b.id===body.branch_id)))throw new Error('Revisa el nombre y la sucursal del ejemplo.');
    if(requests.has(body.request_id))return structuredClone(requests.get(body.request_id));
    if(sources.length>=100)throw new Error('Puedes tener hasta 100 orígenes por negocio.');
    const source={id:crypto.randomUUID(),business_id:businessId,name:body.name.trim(),branch_id:body.branch_id||null,branch_name:branches.find(b=>b.id===body.branch_id)?.name||null,code:crypto.randomUUID().replaceAll('-','').slice(0,16),registration_url:link,visits:0,registrations:0,active_customers:0,first_purchasers:0,repeat_purchasers:0,recorded_sales_q:0};
    sources=[source,...sources];const result={ok:true,source};requests.set(body.request_id,result);return structuredClone(result);
  }
  throw new Error('Esta acción no está disponible en la demostración.');
}
