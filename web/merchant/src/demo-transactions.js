// Entirely synthetic examples. This module performs no network calls or mutations.
const ids = Array.from({ length: 7 }, (_, i) => `cccccccc-cccc-4ccc-8ccc-${String(i + 1).padStart(12, '0')}`);
function fixture() {
  const definitions = [
    ['purchase','Compra',18,90,'POSTED','online'], ['purchase','Compra',12,60,'POSTED','offline'],
    ['redemption','Canje',-25,0,'POSTED','redeem'], ['refund','Reversión',-12,0,'POSTED','reversal'],
    ['opening_balance','Saldo inicial',80,0,'POSTED','migration'], ['adjustment','Ajuste de saldo',4,0,'POSTED','ledger_correction'], ['purchase','Compra',8,40,'POSTED','external']
  ];
  return definitions.map(([kind,label,points,amount_q,status,source],index) => ({
    id: ids[index],record: kind === 'adjustment' ? 'adjustment' : 'transaction',kind,label,points,amount_q,status,source,
    created_at: new Date(Date.UTC(2026,10,11,18-index)).toISOString(),customer_id:'dddddddd-dddd-4ddd-8ddd-000000000001',customer_name:'Ana · ejemplo',staff_name:'María · ejemplo',branch_name:'Centro · ejemplo',
    visits:0,items:0,available_at:null,expired_at:null,evidence: index === 0 ? 'recorded' : 'partial',
    redemption: kind === 'redemption' ? { id:'eeeeeeee-eeee-4eee-8eee-000000000001',points_cost:25,reward_name:'Café de la casa · ejemplo',status:'REDEEMED' } : null,
    adjustment: kind === 'adjustment' ? {points:4,pending_points:-2,lifetime_points:0} : null,
    links:{original_id:kind === 'refund' ? ids[1] : null,reversal_id:index === 1 ? ids[3] : null}
  }));
}
function detail(movement) {
  const award = movement.id === ids[0] ? {
    schema_version:1,algorithm:'pf-points-v1',rule_version:'a'.repeat(64),evaluated_at:movement.created_at,clock:'server',time_zone:'America/Guatemala',local_weekday:3,local_hour:12,
    inputs:{amount_q:90,visits:0,items:0},program:{type:'SPEND',rate:0.1,round:'ceil',quantity:90},base_points:9,program_points:18,
    rules:[{index:0,present:true,active:true,program_type:null,kind:'multiplier',value:2,max_points:null,condition:{weekdays:[3],min_amount_q:null,min_visits:null,min_items:null,start_hour:null,end_hour:null},outcome:'applied',points_before:9,points_after:18}],
    targeted_offer:{bonus_points:0,campaign_id:null,criteria:'not_snapshotted'},awarded_points:18,hold_days:0,initial_status:'POSTED',available_at:null,offline_capture:null
  } : null;
  const limitations = ['Los nombres son los que figuran actualmente en PF. Este detalle no reconstruye el saldo anterior ni el saldo posterior.'];
  if (!award) limitations.unshift(movement.kind === 'purchase' ? 'No se guardaron las reglas evaluadas de esta compra. No se puede reconstruir su cálculo con la configuración actual.' : movement.kind === 'refund' ? 'La reversión de puntos no confirma una devolución de dinero. Comprueba el recibo en tu caja.' : movement.kind === 'opening_balance' ? 'El saldo inicial no representa una compra ni puntos calculados con las reglas del programa.' : movement.kind === 'adjustment' ? 'Este ajuste corrige saldos. No representa una compra ni modifica los puntos del movimiento original.' : 'El costo registrado del canje no depende del precio actual de la recompensa. Las condiciones de elegibilidad de ese momento no se guardaron.');
  return {movement,explanation:{coverage:award?'recorded':'partial',award,steps:[{label:'Puntos registrados',points:movement.points}],limitations}};
}
export async function demoTransactions(url, options = {}) {
  if ((options.method || 'GET') !== 'GET') throw Object.assign(new Error('Esta consulta es de solo lectura.'),{status:405});
  const base='/api/admin/transaction-history',rows=fixture();
  if (url.pathname === base) {
    const kind=url.searchParams.get('kind')||'all',limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')||25))),offset=Math.max(0,Number(url.searchParams.get('cursor')||0));
    const filtered=rows.filter(row=>{
      const group=row.source==='external'?'pos':'staff',staff='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
      return (kind==='all'||row.kind===kind)
        && (!url.searchParams.get('staff_id')||(group==='staff'&&url.searchParams.get('staff_id')===staff))
        && (!url.searchParams.get('source_group')||url.searchParams.get('source_group')===group)
        && (!url.searchParams.get('branch_id')||(row.kind!=='adjustment'&&url.searchParams.get('branch_id')==='22222222-2222-4222-8222-222222222222'))
        && (!url.searchParams.get('start')||Date.parse(row.created_at)>=Date.parse(url.searchParams.get('start')))
        && (!url.searchParams.get('end')||Date.parse(row.created_at)<Date.parse(url.searchParams.get('end')));
    });
    return {movements:filtered.slice(offset,offset+limit),next_cursor:filtered.length>offset+limit?String(offset+limit):null,limit};
  }
  const selected=rows.find(row=>row.id===url.pathname.slice(base.length+1));
  if (!selected) throw Object.assign(new Error('No se encontró ese movimiento en este negocio.'),{status:404});
  return detail(selected);
}
