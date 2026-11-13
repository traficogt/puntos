import {demoOperatingMode} from './demo-owner-operating-state.js';
import { demoAudienceSnapshot } from "./demo-audiences.js";
import { demoRecovery } from "./demo-recovery.js";
const day = 86400000, now = Date.now();
const campaigns = [{ id: "demo-growth-active", name: "Vuelve por tu café · ejemplo", status: "active", points_budget: 3000, points_committed: 1200, points_remaining: 1800, budget_exhausted: false, bonus_points: 50, minimum_purchase_q: 50, duration_days: 14, holdout_percent: 20, estimated_cost_per_point_q: 0.04, member_count: 100, treatment_count: 80, control_count: 20, starts_at: new Date(now - 7 * day).toISOString(), expires_at: new Date(now + 7 * day).toISOString() }];
const requests = new Map(), queued = new Set(), preflights = new Map(), preparations = new Map();
const blank = members => ({ members, returned_customers: 0, return_rate_pct: 0, recorded_sales_q: 0, average_sales_per_member_q: 0 });
function results(c) {
  const sample=c.id==='demo-growth-active';
  const treatment=sample?{members:80,returned_customers:24,return_rate_pct:30,recorded_sales_q:2400,average_sales_per_member_q:30,return_rate_interval:{lower:0.21065,upper:0.40768}}:blank(c.treatment_count);
  const control=sample?{members:20,returned_customers:4,return_rate_pct:20,recorded_sales_q:320,average_sales_per_member_q:16,return_rate_interval:{lower:0.08066,upper:0.41602}}:blank(c.control_count);
  const quiet=c.offer_kind==='quiet',asOf=new Date().toISOString();
  return {treatment,control,estimated_incremental_sales_q:sample?1120:c.status==='draft'||quiet?null:0,bonus_points_issued:sample?1200:0,estimated_incentive_cost_q:sample?48:c.estimated_cost_per_point_q==null?null:0,small_sample:true,
    measurement_kind:quiet?'descriptive':'randomized_comparison',
    measurement:{state:c.status==='draft'?'not_started':quiet?'descriptive':c.status==='paused'?'interrupted':'in_progress',as_of:asOf,denominator:'all_assigned',method:quiet?null:'newcombe_wilson_95',
      return_difference:sample?{estimate_pp:10,lower_pp:-13.37685,upper_pp:26.07417,confidence_level:0.95}:null,
      window:{starts_at:c.starts_at,ends_at:c.expires_at,observed_until:c.starts_at?asOf:null,complete:false,time_basis:'transaction_created_at'},
      data_readiness:{state:'recorded_only',summary:'Ejemplo con compras registradas en PF; no acredita todas las ventas del negocio.'},unavailable_members:0,assignment_counts_match:true,
      messages:{accepted:0,delivered:null,read:null}}};
}
function messages(c) {
  const count = queued.has(c.id) ? 12 : 0;
  return { ok: true, preview: { body: `Café Jacaranda: recibe ${c.bonus_points} puntos extra en una compra desde Q${c.minimum_purchase_q}. Una vez por cliente hasta ${c.expires_at?.slice(0,10)}. Sujeta a los puntos disponibles de la campaña. Consulta tus ofertas en tu tarjeta PF. Puedes dejar de recibir promociones desde tus preferencias.`, delivery_note: "Ejemplo sin envío real. En producción se respeta el horario de 09:00 a 18:00 de Guatemala y un mensaje de campaña cada 7 días." }, eligible_count: count ? 0 : 12, counts: { queued: count, processing: 0, accepted: 0, failed: 0, uncertain: 0, suppressed: 0 }, total: count, can_queue: c.status === "active" && !count };
}
export function demoGrowth(url, options = {}) {
  const suffix = url.pathname.replace("/api/admin/growth-campaigns", ""), method = options.method || "GET", body = JSON.parse(options.body || "{}");
  if (!suffix && method === "GET") { const limit = Number(url.searchParams.get("limit") || 20), offset = Number(url.searchParams.get("offset") || 0); return { campaigns: campaigns.slice(offset, offset + limit), total: campaigns.length, limit, offset }; }
  if (["", "/quiet", "/prepare"].includes(suffix) && method === "POST") {
    const quiet = suffix === "/quiet", bulk = suffix === "/prepare";
    if (quiet && (!Number.isInteger(body.duration_minutes) || body.duration_minutes < 30 || body.duration_minutes > 240 || body.points_budget == null)) throw new Error("Revisa la vigencia y el límite de la oferta breve.");
    const old = requests.get(body.request_id);
    if (old) { if (old.signature !== JSON.stringify({suffix,body})) throw new Error("Solicitud ya usada con otros datos."); return { campaign: old.campaign }; }
    const run = demoRecovery(new URL("https://preview.invalid/api/admin/analytics/recovery/runs")).runs.find(r => r.id === body.recovery_run_id);
    const audience = body.audience_segment_id ? demoAudienceSnapshot(body.audience_segment_id, body.audience_segment_version, body.audience_limit, { minimum: quiet ? 1 : 10, maximum: bulk ? 5000 : 200 }) : null;
    if (!run && !audience) throw new Error("Selecciona una lista o una audiencia existente.");
    if (body.points_budget != null && (!Number.isInteger(body.points_budget) || body.points_budget < body.bonus_points || body.points_budget > 2000000)) throw new Error("Revisa el límite de puntos.");
    const c = { ...body, offer_kind: quiet ? "quiet" : "experiment", duration_days: quiet ? null : body.duration_days, holdout_percent: quiet ? 0 : body.holdout_percent ?? 20, duration_minutes: quiet ? body.duration_minutes : null, preparation_status: bulk ? "queued" : "ready", prepared_count: 0, id: crypto.randomUUID(), status: "draft", points_budget: body.points_budget ?? null, points_committed: 0, points_remaining: body.points_budget ?? null, budget_exhausted: false, member_count: audience?.member_count ?? run.member_count, audience_snapshot: audience?.snapshot ?? null, treatment_count: 0, control_count: 0, starts_at: null, expires_at: null };
    if (bulk) {
      preparations.set(c.id, { total: c.member_count, availableAt: Date.now() + 1800 });
      c.audience_snapshot = { ...c.audience_snapshot, preparation: 'background' }; c.member_count = 0;
    }
    campaigns.unshift(c); requests.set(body.request_id, { signature: JSON.stringify({suffix,body}), campaign: c }); return { campaign: c };
  }
  const [, id, action, subaction] = suffix.split("/");
  const c = campaigns.find(item => item.id === id);
  if (!c) throw new Error("Campaña de ejemplo no encontrada.");
  if (!action && method === "GET") {
    const preparation = preparations.get(c.id);
    if (preparation && ['queued','preparing'].includes(c.preparation_status) && Date.now() >= preparation.availableAt) {
      c.member_count = preparation.total; c.prepared_count = preparation.total; c.preparation_status = 'ready';
    }
    return { campaign: c, results: results(c) };
  }
  if(action==='collision-preview'&&method==='POST')return demoCollision(c,body);
  if (action === 'preparation' && method === 'POST') {
    if (['ready','cancelled'].includes(c.preparation_status)) throw new Error('Esta preparación ya terminó.');
    if (subaction === 'cancel') c.preparation_status = 'cancelled';
    else if (subaction === 'retry') { c.preparation_status = 'queued'; preparations.get(c.id).availableAt = Date.now() + 1800; }
    else throw new Error('Acción no disponible.');
    return { campaign: c };
  }
  if (action === 'preflight' && method === 'POST') {
    const controls = c.offer_kind === 'quiet' ? 0 : Math.max(1, Math.round(c.member_count * c.holdout_percent / 100));
    const count = Math.max(0,c.member_count-controls), commitment = Math.min(count,c.points_budget == null ? count : Math.floor(c.points_budget/c.bonus_points))*c.bonus_points;
    const mode=demoOperatingMode(),capacityBlocked=c.offer_kind==='quiet'&&mode.capacity!==null&&demoOccupiedOperatingCapacity(c.id)+commitment/c.bonus_points>mode.capacity;
    const id = crypto.randomUUID(); preflights.set(c.id,id);
    return { preflight: { id, expires_at: new Date(Date.now()+600000).toISOString(), generated_at: new Date().toISOString(), can_activate: !capacityBlocked&&c.preparation_status === 'ready' && c.member_count >= (c.offer_kind === 'quiet' ? 1 : 10),
      audience_count: c.member_count, treatment_count: count, control_count: controls, maximum_commitment_points: commitment,
      maximum_incentive_cost_q: c.estimated_cost_per_point_q == null ? null : commitment*c.estimated_cost_per_point_q,
      stacking: { targeted_offers_per_purchase: 1, external_discounts: 'unknown', maximum_targeted_bonus_per_purchase: c.bonus_points, maximum_total_points_per_purchase: null, sample_program_points: 1, sample_total_points: c.bonus_points+1 },
      contacts: { without_permission_or_phone: Math.round(c.member_count/3), frequency_excluded: 0, eligible_now: c.member_count-Math.round(c.member_count/3), minimum_contact_days: 7 },
      data_readiness: { summary: 'Ejemplo con compras registradas en PF; no acredita todas las ventas del negocio.' }, reward_availability: {state:'not_applicable'}, blockers: capacityBlocked?[{code:'capacity_exceeded',message:'Los bonos pendientes y nuevos superan la capacidad de ejemplo.'}]:[], warnings: c.estimated_cost_per_point_q == null ? [{code:'cost_unknown',message:'Sin costo por punto: el costo en dinero es desconocido.'}] : [] } };
  }
  if (action === "messages" && method === "GET") return messages(c);
  if (action === "messages" && subaction === "queue" && method === "POST") { const replayed = queued.has(c.id); if (c.status !== "active" || body.confirm !== true) throw new Error("Revisa la campaña y confirma el envío."); queued.add(c.id); return { ...messages(c), queued_count: replayed ? 0 : 12, replayed }; }
  if (action === "activate" && method === "POST") {
    const mode=demoOperatingMode();if(c.status==='draft'&&c.offer_kind==='quiet'&&mode.capacity!==null&&demoOccupiedOperatingCapacity(c.id)+Math.min(c.member_count,Math.floor(c.points_budget/c.bonus_points))>mode.capacity)throw new Error('Las ofertas vigentes ya ocupan la capacidad.');
    if (c.status === "paused") throw new Error("Una campaña pausada no puede reactivarse.");
    if (c.preparation_status && c.preparation_status !== 'ready') throw new Error('Espera a que termine la preparación.');
    if ((c.offer_kind === 'quiet' || c.audience_snapshot?.preparation === 'background') && (!body.preflight_id || body.preflight_id !== preflights.get(c.id))) throw new Error('Revisa la comprobación previa.');
    if (c.member_count < (c.offer_kind === 'quiet' ? 1 : 10)) throw new Error("Necesitas al menos 10 clientes para comparar grupos.");
    if (c.status === "draft") { c.status = "active"; c.control_count = c.offer_kind === "quiet" ? 0 : Math.max(1, Math.round(c.member_count * c.holdout_percent / 100)); c.treatment_count = c.member_count - c.control_count; c.starts_at = new Date().toISOString(); c.expires_at = new Date(Date.parse(c.starts_at) + (c.offer_kind === "quiet" ? c.duration_minutes * 60000 : c.duration_days * day)).toISOString(); }
    return { campaign: c };
  }
  if (action === "pause" && method === "POST") { c.status = "paused"; return { campaign: c }; }
  throw new Error("Acción no disponible en la demostración.");
}

export function demoOperatingDrafts(){return structuredClone(campaigns.filter(c=>c.status==='draft'&&c.offer_kind==='quiet'));}
export function demoOccupiedOperatingCapacity(excludeId=null){return campaigns.filter(c=>c.id!==excludeId&&c.offer_kind==='quiet'&&c.status==='active'&&new Date(c.expires_at)>new Date()).reduce((total,c)=>total+Math.min(c.treatment_count,Math.floor((c.points_budget-c.points_committed)/c.bonus_points)),0);}
export function demoActivateOperatingCampaign(template){const c={...template.terms,id:crypto.randomUUID(),name:template.name,status:'active',operating_template_id:template.id,offer_kind:'quiet',duration_days:null,holdout_percent:0,points_committed:0,points_remaining:template.terms.points_budget,budget_exhausted:false,member_count:template.audience_count,treatment_count:template.audience_count,control_count:0,starts_at:new Date().toISOString(),expires_at:new Date(Date.now()+template.terms.duration_minutes*60000).toISOString(),preparation_status:'ready'};campaigns.unshift(c);return structuredClone(c);}
function demoCollision(c,input){
 if(!Number.isFinite(input.amount_q)||input.amount_q<0)throw new Error('Ingresa una compra válida.');
 const options={branches:[{id:'demo-centro',name:'Centro'},{id:'demo-norte',name:'Norte'}],rewards:[{id:'demo-coffee',name:'Café de la casa',points_cost:50,active:true,stock:20,available:true,branch_ids:['demo-centro']},{id:'demo-dessert',name:'Postre del día',points_cost:100,active:true,stock:0,available:false,branch_ids:[]}],tiers:[{id:'demo-gold',name:'Oro',points_multiplier:1.5,perks:['Atención prioritaria']} ]};
 const reward=options.rewards.find(r=>r.id===input.reward_id),tier=options.tiers.find(t=>t.id===input.tier_id),issues=[];
 if(reward){if(!reward.available)issues.push('unavailable');if(reward.stock===0)issues.push('out_of_stock');if(reward.branch_ids.length&&!reward.branch_ids.includes(input.branch_id))issues.push(input.branch_id?'wrong_branch':'select_branch');}
 const program=Math.ceil(input.amount_q*0.1),eligible=[c,...campaigns.filter(item=>item.id!==c.id&&item.status==='active'&&new Date(item.expires_at)>new Date())].filter(item=>item.minimum_purchase_q<=input.amount_q).sort((a,b)=>Date.parse(a.expires_at??new Date(Date.now()+(a.duration_minutes??43200)*60000).toISOString())-Date.parse(b.expires_at??new Date(Date.now()+(b.duration_minutes??43200)*60000).toISOString())||a.id.localeCompare(b.id)),combinations=eligible.map(item=>({campaign_id:item.id,name:item.name,bonus_points:item.bonus_points,total_points:program+item.bonus_points})),mode=demoOperatingMode();
 return {ok:true,generated_at:new Date().toISOString(),currency:'GTQ',sample:{inputs:input,program_points:program,combinations,rejected_combinations:[],most_generous_supported_total:combinations[0]?.total_points??program,maximum_candidate_total:Math.max(program,...combinations.map(row=>row.total_points)),selected_path:{would_reject:false,campaign_id:eligible[0]?.id??null},maximum_hypothetical_within_guard:Math.max(program,...combinations.map(row=>row.total_points)),hard_guard:null,external_discounts:'unknown',tier_awards:'not_applied_by_purchase_writer',targeted_offers_per_purchase:1},options,contacts:{pending_contacts:2,shared_customers:1,frequency_excluded:1,without_permission_or_phone:2},operating_mode:mode,capacity:{configured:mode.capacity,occupied_operational_units:demoOccupiedOperatingCapacity(),proposed_units:Math.min(c.member_count,Math.floor((c.points_budget??c.member_count*c.bonus_points)/c.bonus_points))},reward_availability:{reward,issues,inventory_note:'Ejemplo ficticio; no reserva existencias.'},tier:tier?{...tier,applied_to_sample:false}:null,remediation:issues.length?[{code:'reward',message:'Revisa la sucursal y disponibilidad de este premio de ejemplo.'}]:[],notes:['Datos ficticios. Esta compra usa 0.1 puntos por unidad monetaria y un solo bono dirigido. No registra ventas ni envía mensajes.','El valor de descuentos externos y beneficios descriptivos de nivel es desconocido. Los niveles no aumentan el total calculado.']};
}
