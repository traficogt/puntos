import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../database.js';
import { badRequest, conflict, notFound } from '../../utils/http-error.js';
import { readinessForBusiness, campaignNeedsFreshActivity } from './merchant-data-readiness.js';
import { businessRegion } from './regional-settings.js';
import { computePointsWithEvidence } from './points-service.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Read all participating customers in one statement. No phone/name is returned
 * to the owner or stored in the preview; the private digest binds eligibility. */
export async function evaluateCampaignPreflight({ businessId, campaign, business = null, now = null }, client) {
  const currentTime = now ?? new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at);
  const settings = business ?? (await client.query('SELECT * FROM businesses WHERE id=$1::uuid', [businessId])).rows[0];
  if (!settings) throw notFound('No se encontró el negocio.');
  const days = Math.max(7, Math.min(90, Number.isInteger(settings.program_json?.lifecycle?.minimum_contact_days) ? settings.program_json.lifecycle.minimum_contact_days : 7));
  const { rows } = await client.query(`WITH contacts AS (
      SELECT customer_id,max(last_attempt_at) AS last_at FROM (
        SELECT customer_id,last_attempt_at FROM growth_message_outbox WHERE business_id=$1 AND status IN ('processing','accepted','uncertain')
        UNION ALL SELECT customer_id,last_attempt_at FROM lifecycle_message_outbox WHERE business_id=$1 AND status IN ('processing','accepted','uncertain')
      ) log GROUP BY customer_id
    ) SELECT m.id,m.customer_id,c.deleted_at,c.id IS NOT NULL AND c.deleted_at IS NULL AS active,
      COALESCE(p.marketing_opt_in,false) AND COALESCE(c.phone ~ '^[+0-9 ().-]+$' AND regexp_replace(c.phone,'[^0-9]','','g') ~ '^[0-9]{8,15}$',false) AS contactable,
      COALESCE(ct.last_at>$3::timestamptz-$4::int*interval '1 day',false) AS frequency_excluded
    FROM growth_campaign_members m LEFT JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id
    LEFT JOIN customer_marketing_preferences p ON p.business_id=m.business_id AND p.customer_id=m.customer_id
    LEFT JOIN contacts ct ON ct.customer_id=m.customer_id
    WHERE m.business_id=$1 AND m.campaign_id=$2 ORDER BY m.id`, [businessId, campaign.id, currentTime, days]);
  const active = rows.filter(row => row.active), count = active.length;
  const controls = campaign.offer_kind === 'quiet' ? 0 : Math.max(1, Math.round(count * campaign.holdout_percent / 100));
  const treatmentCount = Math.max(0, count - controls);
  const maximumPoints = Math.min(treatmentCount, campaign.points_budget == null ? treatmentCount : Math.floor(campaign.points_budget / campaign.bonus_points)) * campaign.bonus_points;
  const overlaps = (await client.query(`SELECT g.id,g.bonus_points,g.expires_at,COUNT(*)::int AS members FROM growth_campaigns g
      JOIN growth_campaign_members m ON m.business_id=g.business_id AND m.campaign_id=g.id AND m.allocation='treatment' AND m.claimed_at IS NULL
      JOIN growth_campaign_members own ON own.business_id=m.business_id AND own.customer_id=m.customer_id AND own.campaign_id=$2
      WHERE g.business_id=$1 AND g.id<>$2 AND g.status='active' AND g.expires_at>$3
      AND (g.points_budget IS NULL OR g.points_committed<=g.points_budget-g.bonus_points)
      GROUP BY g.id ORDER BY g.expires_at,g.id`, [businessId, campaign.id, currentTime])).rows;
  const region = businessRegion(settings), readiness = readinessForBusiness(settings, currentTime);
  const guard = Number(settings.program_json?.award_guard?.max_points_per_tx ?? 0);
  const sample = computePointsWithEvidence(settings, { amount_q: Number(campaign.minimum_purchase_q), visits: 1, items: 1 }, { now: currentTime, timeZone: region.timezone });
  const blockers = [];
  if ((campaign.preparation_status ?? 'ready') !== 'ready') blockers.push({ code: 'preparation_not_ready', message: 'Espera a que termine la preparación de participantes.' });
  if (count < (campaign.offer_kind === 'quiet' ? 1 : 10)) blockers.push({ code: 'insufficient_members', message: campaign.offer_kind === 'quiet' ? 'Necesitas al menos un cliente activo.' : 'Necesitas al menos 10 clientes activos para comparar grupos.' });
  if (guard > 0 && campaign.bonus_points > guard) blockers.push({ code: 'bonus_exceeds_purchase_guard', message: 'El bono supera el límite de puntos por compra del programa. Revisa los términos antes de activar.' });
  if (!readiness.inactivity_allowed && campaignNeedsFreshActivity(campaign)) blockers.push({ code: 'data_not_ready', message: readiness.summary });
  const warnings = [];
  if (campaign.estimated_cost_per_point_q == null) warnings.push({ code: 'cost_unknown', message: 'No hay costo por punto configurado: el compromiso en dinero y la rentabilidad son desconocidos.' });
  if (guard > 0 && sample.points + campaign.bonus_points > guard) warnings.push({ code: 'sample_exceeds_purchase_guard', message: 'La compra de ejemplo excede el límite de puntos por compra. El servidor rechazará compras que lo excedan; el bono no reduce los puntos normales.' });
  if (overlaps.length) warnings.push({ code: 'overlapping_offers', message: 'Hay participantes con otra oferta. Se aplica un solo bono dirigido por compra: el que vence primero.' });
  const contactable = active.filter(row => row.contactable), frequencyExcluded = contactable.filter(row => row.frequency_excluded).length;
  const report = {
    offer_kind: campaign.offer_kind ?? 'experiment', can_activate: campaign.status === 'draft' && blockers.length === 0,
    currency: region.currency, timezone: region.timezone, audience_count: count, excluded_inactive_count: rows.length - count,
    treatment_count: treatmentCount, control_count: controls,
    maximum_commitment_points: maximumPoints,
    maximum_incentive_cost_q: campaign.estimated_cost_per_point_q == null ? null : maximumPoints * Number(campaign.estimated_cost_per_point_q),
    cost_assumptions: { per_point_q: campaign.estimated_cost_per_point_q == null ? null : Number(campaign.estimated_cost_per_point_q), excludes: ['messages', 'operations', 'regular_program_points', 'external_discounts'] },
    stacking: { targeted_offers_per_purchase: 1, priority: 'earliest_expiry_then_id', regular_program_points: 'added_before_targeted_bonus', external_discounts: 'unknown', overlapping_campaigns: overlaps.length,
      maximum_targeted_bonus_per_purchase: Math.max(campaign.bonus_points, ...overlaps.map(row => row.bonus_points)),
      maximum_total_points_per_purchase: guard > 0 ? guard : null,
      sample_purchase_q: Number(campaign.minimum_purchase_q), sample_program_points: sample.points, sample_total_points: sample.points + campaign.bonus_points,
      sample_note: 'Ejemplo con la compra mínima, una visita y un artículo. El total depende de la compra, las reglas y la hora; no es una promesa ni un máximo.' },
    contacts: { assessed_population: 'all_saved_members_before_random_assignment', consent_required: true, minimum_contact_days: days,
      without_permission_or_phone: count - contactable.length, frequency_excluded: frequencyExcluded, eligible_now: contactable.length - frequencyExcluded,
      note: 'Estimación antes de asignar grupos. Los mensajes excluyen el grupo de comparación y comprueban de nuevo permiso, frecuencia, horario y vencimiento al enviar. Activar no envía mensajes.' },
    data_readiness: readiness,
    reward_availability: { state: 'not_applicable', reason: 'Esta oferta concede puntos; no reserva un premio ni acredita existencias para canjearlos.' },
    blockers, warnings, generated_at: currentTime.toISOString(),
  };
  // Exclude wall-clock text while binding rule version/time bucket, snapshot,
  // member consent and collisions. New observations require a fresh owner review.
  const fingerprint = digest({ report: { ...report, generated_at: undefined, data_readiness: { ...readiness, checked_at: undefined } }, members: rows,
    terms: [campaign.bonus_points,campaign.minimum_purchase_q,campaign.points_budget,campaign.duration_days,campaign.duration_minutes,campaign.holdout_percent,campaign.audience_snapshot],
    overlaps, rule_version: sample.evidence.rule_version });
  return { report, fingerprint, now: currentTime };
}
export async function createCampaignPreflight({ businessId, campaignId }, { transaction = withTransaction } = {}) {
  return transaction(async client => {
    const business = (await client.query('SELECT * FROM businesses WHERE id=$1::uuid FOR SHARE', [businessId])).rows[0];
    const campaign = (await client.query('SELECT * FROM growth_campaigns WHERE business_id=$1 AND id=$2 FOR SHARE', [businessId,campaignId])).rows[0];
    if (!campaign) throw notFound('No se encontró esta campaña.');
    const evaluated = await evaluateCampaignPreflight({ businessId,campaign,business },client);
    const id = randomUUID(), expiresAt = new Date(evaluated.now.getTime()+10*60000);
    await client.query('INSERT INTO growth_campaign_preflights(id,business_id,campaign_id,fingerprint,snapshot,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [id,businessId,campaignId,evaluated.fingerprint,evaluated.report,expiresAt]);
    return { preflight: { ...evaluated.report, id, expires_at: expiresAt.toISOString() } };
  });
}
export async function validateCampaignPreflight({ businessId, campaign, preflightId },client) {
  if ((campaign.offer_kind === 'quiet' || campaign.audience_snapshot?.preparation === 'background') && !preflightId) throw conflict('Revisa la comprobación previa antes de activar esta oferta.');
  const evaluated = await evaluateCampaignPreflight({ businessId,campaign },client);
  if (!preflightId && campaign.offer_kind !== "quiet" && evaluated.report.blockers.some(item => item.code === "insufficient_members") && (campaign.preparation_status ?? "ready") === "ready") throw badRequest("Se necesitan al menos 10 clientes activos para comparar la campaña.");
  if (!evaluated.report.can_activate) throw conflict(evaluated.report.blockers.map(b=>b.message).join(' ') || 'Esta campaña no se puede activar.');
  if (preflightId) {
    const previous = (await client.query('SELECT fingerprint FROM growth_campaign_preflights WHERE business_id=$1 AND campaign_id=$2 AND id=$3 AND expires_at>clock_timestamp()',[businessId,campaign.id,preflightId])).rows[0];
    if (!previous || previous.fingerprint !== evaluated.fingerprint) throw conflict('La comprobación previa cambió o venció. Actualízala y vuelve a revisar los términos.');
  }
  return evaluated.report;
}
