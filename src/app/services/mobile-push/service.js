import { z } from 'zod';
import { HttpError, badRequest, conflict } from '../../../utils/http-error.js';
import { planFeaturesWithOverrides } from '../../../utils/plan.js';

const credentials = {
  installationId: z.guid(),
  installationSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value,'base64url').toString('base64url') === value)
};
const credentialSchema = z.object(credentials).strict();
const registrationSchema = z.object({ ...credentials,token:z.string().regex(/^(?:[a-fA-F0-9]{2}){16,256}$/),platform:z.literal('ios') }).strict();
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest('Datos de notificaciones inválidos.');
  return result.data;
}
const unavailable = () => new HttpError(503,'Notificaciones no disponibles. Intenta de nuevo más tarde.');
function payload(snapshot, kind, test = false) {
  return { aps:{alert:{title:'PuntosFieles',body:test ? 'Las notificaciones están activas.'
    : kind==='rewards' ? 'Tienes una recompensa disponible. Abre PuntosFieles para verla.'
      : 'Tu tarjeta tiene novedades. Abre PuntosFieles para verlas.'},sound:'default'},
  kind,customerId:snapshot.customer_id,businessId:snapshot.business_id };
}

export function createMobilePushService({ repo,provider,settings,getRewardProgress,planConfigService,globalContext }) {
  const available = () => Boolean(settings.ready && provider);
  const run = fn => globalContext(fn);
  const assertAvailable = () => { if (!available()) throw unavailable(); };
  async function kindFor(snapshot) {
    if (Number(snapshot.points)<=Number(snapshot.baseline_points)) return 'card';
    const overrides = await planConfigService.getPlanFeatureOverrides();
    if (!planFeaturesWithOverrides(snapshot.plan,overrides).rewards) return 'card';
    const progress = await getRewardProgress({ businessId: snapshot.business_id, customerId: snapshot.customer_id });
    return (progress?.choices ?? []).some(reward => reward.active && reward.available
      && Number(reward.points_cost)>Number(snapshot.baseline_points) && Number(reward.points_cost)<=Number(snapshot.points)) ? 'rewards' : 'card';
  }
  return {
    status() { return { available:available() }; },
    async register(auth, session, input) {
      assertAvailable(); const data = parse(registrationSchema,input);
      return run(()=>repo.register({ ...data,token:data.token.toLowerCase(),businessId:auth.business_id,customerId:auth.id,
        sessionId:session.id,topic:settings.config.topic }));
    },
    async revoke(input) {
      const data = parse(credentialSchema,input);
      return run(()=>repo.revoke(data.installationId,data.installationSecret));
    },
    async test(auth, input) {
      assertAvailable(); const data = parse(credentialSchema,input);
      const claim = await run(()=>repo.claimTest({ ...data,businessId:auth.business_id,customerId:auth.id }));
      if (!claim) throw conflict('No se pudo enviar la prueba. Revisa la activación e intenta en un minuto.');
      try {
        const snapshot = await run(()=>repo.getSnapshot(claim));
        if (!snapshot || snapshot.topic!==settings.config.topic || snapshot.customer_id!==auth.id || snapshot.business_id!==auth.business_id) throw unavailable();
        const result = await provider.send({ token:snapshot.token,payload:payload(snapshot,'card',true),collapseId:`pf-test-${snapshot.installation_id}` });
        if (!result.accepted) { await run(()=>repo.fail(claim,result)); throw unavailable(); }
        return { sent:true };
      } finally { await run(()=>repo.releaseTest(claim)); }
    },
    async processDue() {
      const totals = { sent:0,failed:0,skipped:0 };
      if (!available()) return totals;
      const claims = await run(()=>repo.claimDue(20));
      for (const claim of claims) {
        try {
          let snapshot = await run(()=>repo.getSnapshot(claim));
          if (!snapshot) { totals.skipped++; continue; }
          if (snapshot.topic!==settings.config.topic) { await run(()=>repo.fail(claim,{retryable:false})); totals.failed++; continue; }
          if (Number(snapshot.points)===Number(snapshot.baseline_points) && Number(snapshot.pending_points)===Number(snapshot.baseline_pending)) {
            await run(()=>repo.acknowledge(claim,snapshot)); totals.skipped++; continue;
          }
          const kind = await kindFor(snapshot);
          // No network transaction: check generation, revocation and lease again
          // immediately before submitting to APNs. Never acknowledge a new revision.
          const latest = await run(()=>repo.getSnapshot(claim));
          if (!latest) { totals.skipped++; continue; }
          if (latest.revision!==snapshot.revision) {
            await run(()=>repo.fail(claim,{retryable:true})); totals.skipped++; continue;
          }
          snapshot = latest;
          const result = await provider.send({ token:snapshot.token,payload:payload(snapshot,kind),collapseId:`pf-${kind}-${snapshot.installation_id}` });
          if (result.accepted) { await run(()=>repo.acknowledge(claim,snapshot)); totals.sent++; }
          else { await run(()=>repo.fail(claim,result)); totals.failed++; }
        } catch {
          await run(()=>repo.fail(claim,{retryable:true})); totals.failed++;
        }
      }
      return totals;
    }
  };
}
