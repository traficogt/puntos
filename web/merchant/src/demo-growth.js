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
    const id = crypto.randomUUID(); preflights.set(c.id,id);
    return { preflight: { id, expires_at: new Date(Date.now()+600000).toISOString(), generated_at: new Date().toISOString(), can_activate: c.preparation_status === 'ready' && c.member_count >= (c.offer_kind === 'quiet' ? 1 : 10),
      audience_count: c.member_count, treatment_count: count, control_count: controls, maximum_commitment_points: commitment,
      maximum_incentive_cost_q: c.estimated_cost_per_point_q == null ? null : commitment*c.estimated_cost_per_point_q,
      stacking: { targeted_offers_per_purchase: 1, external_discounts: 'unknown', maximum_targeted_bonus_per_purchase: c.bonus_points, maximum_total_points_per_purchase: null, sample_program_points: 1, sample_total_points: c.bonus_points+1 },
      contacts: { without_permission_or_phone: Math.round(c.member_count/3), frequency_excluded: 0, eligible_now: c.member_count-Math.round(c.member_count/3), minimum_contact_days: 7 },
      data_readiness: { summary: 'Ejemplo con compras registradas en PF; no acredita todas las ventas del negocio.' }, reward_availability: {state:'not_applicable'}, blockers: [], warnings: c.estimated_cost_per_point_q == null ? [{code:'cost_unknown',message:'Sin costo por punto: el costo en dinero es desconocido.'}] : [] } };
  }
  if (action === "messages" && method === "GET") return messages(c);
  if (action === "messages" && subaction === "queue" && method === "POST") { const replayed = queued.has(c.id); if (c.status !== "active" || body.confirm !== true) throw new Error("Revisa la campaña y confirma el envío."); queued.add(c.id); return { ...messages(c), queued_count: replayed ? 0 : 12, replayed }; }
  if (action === "activate" && method === "POST") {
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
