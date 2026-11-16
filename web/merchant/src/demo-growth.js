import { normalizeMeasurementPlan, planCampaignExperiment, campaignContribution, campaignDecision } from '../../../src/app/services/campaign-experiment-model.js';
import { measurementCostInput, measurementCostKeys } from './campaign-measurement-inputs.js';
import {demoOperatingMode} from './demo-owner-operating-state.js';
import { demoAudienceSnapshot } from "./demo-audiences.js";
import { demoRecovery } from "./demo-recovery.js";
const day = 86400000, now = Date.now();
const campaigns = [{ id: "demo-growth-active", name: "Vuelve por tu café · ejemplo", status: "active", measurement_plan: null, points_budget: 3000, points_committed: 1200, points_remaining: 1800, budget_exhausted: false, bonus_points: 50, minimum_purchase_q: 50, duration_days: 14, holdout_percent: 20, estimated_cost_per_point_q: 0.04, member_count: 100, treatment_count: 80, control_count: 20, starts_at: new Date(now - 7 * day).toISOString(), expires_at: new Date(now + 7 * day).toISOString() }];
const demoPlan={version:1,baseline_return_rate_pct:30,minimum_detectable_lift_pp:10,observation_days:30,reconciliation_days:7};
for(const [id,name,days] of /** @type {const} */ ([['demo-growth-reconciling','Regreso de noviembre · por conciliar',32],['demo-growth-complete','Oferta anterior · resultado incierto',45]]))campaigns.push({...campaigns[0],id,name,measurement_plan:{...demoPlan},holdout_percent:50,points_committed:1600,points_remaining:1400,member_count:200,treatment_count:100,control_count:100,starts_at:new Date(now-days*day).toISOString(),expires_at:new Date(now-(days-14)*day).toISOString()});
const requests = new Map(), queued = new Set(), preflights = new Map(), preparations = new Map(), measurementCosts=new Map(), measurementReports=new Map(), measurementRequests=new Map();
const blank = members => ({ members, returned_customers: 0, return_rate_pct: 0, recorded_sales_q: 0, average_sales_per_member_q: 0 });
function results(c) {
  const sample=c.id==='demo-growth-active',plannedSample=['demo-growth-reconciling','demo-growth-complete'].includes(c.id);
  const treatment=sample?{members:80,returned_customers:24,return_rate_pct:30,recorded_sales_q:2400,average_sales_per_member_q:30,return_rate_interval:{lower:0.21065,upper:0.40768}}:plannedSample?{members:100,returned_customers:32,return_rate_pct:32,recorded_sales_q:3200,average_sales_per_member_q:32,return_rate_interval:{lower:0.2367,upper:0.4166}}:blank(c.treatment_count);
  const control=sample?{members:20,returned_customers:4,return_rate_pct:20,recorded_sales_q:320,average_sales_per_member_q:16,return_rate_interval:{lower:0.08066,upper:0.41602}}:plannedSample?{members:100,returned_customers:29,return_rate_pct:29,recorded_sales_q:2900,average_sales_per_member_q:29,return_rate_interval:{lower:0.2101,upper:0.3854}}:blank(c.control_count);
  const quiet=c.offer_kind==='quiet',asOf=new Date().toISOString(),plan=c.measurement_plan;
  const observationEnds=c.starts_at?plan?new Date(Date.parse(c.starts_at)+plan.observation_days*day).toISOString():c.expires_at:null;
  const reconciliationEnds=observationEnds?new Date(Date.parse(observationEnds)+(plan?.reconciliation_days??0)*day).toISOString():null;
  const complete=Boolean(observationEnds&&Date.now()>=Date.parse(observationEnds)),reconciling=complete&&Date.now()<Date.parse(reconciliationEnds);
  const followupAvailable=Boolean(observationEnds&&Date.parse(observationEnds)>Date.parse(c.expires_at));
  const followup=c.starts_at?{available:followupAvailable,state:complete?reconciling?'reconciling':'complete':'waiting',starts_at:c.expires_at,ends_at:observationEnds,reconciliation_ends_at:reconciliationEnds,treatment:plannedSample?{...blank(100),returned_customers:11,return_rate_pct:11,recorded_sales_q:1100,average_sales_per_member_q:11}:blank(c.treatment_count),control:plannedSample?{...blank(100),returned_customers:12,return_rate_pct:12,recorded_sales_q:1200,average_sales_per_member_q:12}:blank(c.control_count),return_difference:plannedSample&&followupAvailable?{estimate_pp:-1,lower_pp:-10.088,upper_pp:8.029}:null}:null;
  treatment.baseline_purchase_rate_pct=30;control.baseline_purchase_rate_pct=29;
  const diagnostics={assignment_counts_match:true,capture_state:plannedSample?'complete':'unknown',late_purchases:c.id==='demo-growth-reconciling'?3:0,untrusted_time_purchases:sample?2:0,missing_purchase_dates:sample?1:0,legacy_time_purchases:sample?3:0,pending_refunds:c.id==='demo-growth-reconciling'?1:0,overlap_members:0,baseline_imbalance:false,missing_preperiod_members:sample?4:0,receipt_coverage:{total:plannedSample?80:28,linked:plannedSample?80:28,unmatched:0,rejected:0},treatment:{baseline_purchase_rate_pct:30},control:{baseline_purchase_rate_pct:29}};
  const costRecord=measurementCosts.get(c.id),costs=costRecord?.costs??null;
  const out={treatment,control,estimated_incremental_sales_q:sample?1120:plannedSample?300:c.status==='draft'||quiet?null:0,bonus_points_issued:sample?1200:plannedSample?1600:0,estimated_incentive_cost_q:sample?48:plannedSample?64:c.estimated_cost_per_point_q==null?null:0,small_sample:!plannedSample,
    measurement_kind:quiet?'descriptive':'randomized_comparison',planning:planCampaignExperiment({plan,holdoutPercent:c.holdout_percent,availableMembers:c.member_count}),diagnostics,followup,costs,cost_updated_at:costRecord?.updated_at??null,
    contribution:campaignContribution({treatment,control,costs:costs?Object.fromEntries(measurementCostKeys.map(key=>[key,costs[key]])):null}),
    measurement:{state:c.status==='draft'?'not_started':quiet?'descriptive':c.status==='paused'?'interrupted':reconciling?'reconciling':complete?'inconclusive':'in_progress',as_of:asOf,denominator:'all_assigned',method:quiet?null:'newcombe_wilson_95',sample_counts:{treatment:c.treatment_count,control:c.control_count},
      return_difference:sample?{estimate_pp:10,lower_pp:-13.37685,upper_pp:26.07417,confidence_level:0.95}:plannedSample?{estimate_pp:3,lower_pp:-9.647,upper_pp:15.493,confidence_level:0.95}:null,
      window:{starts_at:c.starts_at,ends_at:observationEnds??c.expires_at,observed_until:c.starts_at?complete?observationEnds:asOf:null,complete,time_basis:'purchase_occurred_at_with_recorded_fallback'},
      data_readiness:{state:'recorded_only',summary:'Datos ficticios para explorar la medición; no son resultados de un negocio real.'},unavailable_members:0,assignment_counts_match:true,
      messages:{accepted:0,delivered:null,read:null}}};
  out.decision=campaignDecision(out);
  const latest=(measurementReports.get(c.id)??[]).at(-1),changed=Boolean(latest&&latest.signature!==resultSignature(out));
  out.report_revision={latest:latest?{revision:latest.revision,created_at:latest.created_at}:null,changed,reason:changed?'Los costos o los registros cambiaron desde el último corte. El corte anterior conserva su contenido.':null};
  return out;
}
function resultSignature(result){
 const snapshot=structuredClone(result);delete snapshot.report_revision;delete snapshot.cost_updated_at;
 delete snapshot.measurement.as_of;delete snapshot.measurement.window.observed_until;
 return JSON.stringify(snapshot);
}
function measurementMutation(c,action,body){
 if(typeof body.request_id!=='string'||!body.request_id)throw new Error('Incluye el identificador de la solicitud.');
 const key=`${c.id}:${action}:${body.request_id}`,signature=JSON.stringify(body),old=measurementRequests.get(key);
 if(old){if(old.signature!==signature)throw new Error('La solicitud ya se usó con otros datos.');return structuredClone(old.response);}
 let response;
 if(action==='measurement-costs'){
  const costs=measurementCostInput(body),updated_at=new Date().toISOString();measurementCosts.set(c.id,{costs,updated_at});response={costs,updated_at};
 }else{
  const snapshot=results(c),reports=measurementReports.get(c.id)??[],revision=reports.length+1,created_at=new Date().toISOString();
  reports.push({revision,created_at,signature:resultSignature(snapshot),snapshot:structuredClone(snapshot)});measurementReports.set(c.id,reports);response={revision,created_at};
 }
 measurementRequests.set(key,{signature,response:structuredClone(response)});return response;
}
function messages(c) {
  const count = queued.has(c.id) ? 12 : 0;
  return { ok: true, preview: { body: `Café Jacaranda: recibe ${c.bonus_points} puntos extra en una compra desde Q${c.minimum_purchase_q}. Una vez por cliente hasta ${c.expires_at?.slice(0,10)}. Sujeta a los puntos disponibles de la campaña. Consulta tus ofertas en tu tarjeta PF. Puedes dejar de recibir promociones desde tus preferencias.`, delivery_note: "Ejemplo sin envío real. En producción se respeta el horario de 09:00 a 18:00 de Guatemala y un mensaje de campaña cada 7 días." }, eligible_count: count ? 0 : 12, counts: { queued: count, processing: 0, accepted: 0, failed: 0, uncertain: 0, suppressed: 0 }, total: count, can_queue: c.status === "active" && Date.parse(c.expires_at)>Date.now() && !count };
}
export function demoGrowth(url, options = {}) {
  const suffix = url.pathname.replace("/api/admin/growth-campaigns", ""), method = options.method || "GET", body = JSON.parse(options.body || "{}");
  if(suffix==='/measurement-plan'&&method==='POST'){
    const plan=normalizeMeasurementPlan(body.measurement_plan,{durationDays:body.duration_days,holdoutPercent:body.holdout_percent});
    return {planning:planCampaignExperiment({plan,holdoutPercent:body.holdout_percent,availableMembers:body.available_members})};
  }
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
    const c = { ...body, offer_kind: quiet ? "quiet" : "experiment", duration_days: quiet ? null : body.duration_days, holdout_percent: quiet ? 0 : body.holdout_percent ?? 50, measurement_plan: quiet ? null : normalizeMeasurementPlan(body.measurement_plan,{durationDays:body.duration_days,holdoutPercent:body.holdout_percent??50}), duration_minutes: quiet ? body.duration_minutes : null, preparation_status: bulk ? "queued" : "ready", prepared_count: 0, id: crypto.randomUUID(), status: "draft", points_budget: body.points_budget ?? null, points_committed: 0, points_remaining: body.points_budget ?? null, budget_exhausted: false, member_count: audience?.member_count ?? run.member_count, audience_snapshot: audience?.snapshot ?? null, treatment_count: 0, control_count: 0, starts_at: null, expires_at: null };
    if (bulk) {
      preparations.set(c.id, { total: c.member_count, availableAt: Date.now() + 1800 });
      c.audience_snapshot = { ...c.audience_snapshot, preparation: 'background' }; c.member_count = 0;
    }
    campaigns.unshift(c); requests.set(body.request_id, { signature: JSON.stringify({suffix,body}), campaign: c }); return { campaign: c };
  }
  const [, id, action, subaction] = suffix.split("/");
  const c = campaigns.find(item => item.id === id);
  if (!c) throw new Error("Campaña de ejemplo no encontrada.");
  if(['measurement-costs','measurement-reports'].includes(action)&&method==='POST')return measurementMutation(c,action,body);
  if(action==='measurement-reports'&&method==='GET')return {reports:(measurementReports.get(c.id)??[]).map(({revision,created_at,snapshot})=>({revision,created_at,as_of:snapshot.measurement.as_of,treatment:structuredClone(snapshot.treatment),control:structuredClone(snapshot.control),contribution:structuredClone(snapshot.contribution),decision:structuredClone(snapshot.decision)})).reverse()};
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
  if (action === "messages" && subaction === "queue" && method === "POST") { const replayed = queued.has(c.id); if (c.status !== "active" || Date.parse(c.expires_at)<=Date.now() || body.confirm !== true) throw new Error("Revisa la campaña y confirma el envío."); queued.add(c.id); return { ...messages(c), queued_count: replayed ? 0 : 12, replayed }; }
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
