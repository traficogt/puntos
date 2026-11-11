import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { MessageLogRepo } from "../repositories/message-log-repository.js";
import crypto from "node:crypto";
import { emitBillingEvent } from "./billing-service.js";
import { createMessageRouter } from "./messaging/message-router.js";
import { resolveEmailBranding } from "./messaging/email-branding.js";
import { renderEmailMessage } from "./messaging/email-renderer.js";
import { createDevProvider } from "./messaging/providers/dev-provider.js";
import { createSmtpProvider } from "./messaging/providers/smtp-provider.js";
import { createWhatsAppCloudProvider } from "./messaging/providers/whatsapp-cloud-provider.js";
import { createWahaProvider } from "./messaging/providers/waha-provider.js";
import { createEvolutionProvider } from "./messaging/providers/evolution-provider.js";
import { createTwilioProvider } from "./messaging/providers/twilio-provider.js";
import { createBaileysProvider } from "./messaging/providers/baileys-provider.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { getMarketingPreference, issueMarketingUnsubscribeUrl } from './marketing-preference-service.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';

function id() { return crypto.randomUUID(); }

function inferDestinations(to, destinations) {
  const target = String(to || "").trim();
  const inferredEmail = target.includes("@") ? target : "";
  const inferredPhone = !inferredEmail ? target : "";
  return {
    phone: destinations?.phone || inferredPhone || null,
    email: destinations?.email || inferredEmail || null
  };
}

function buildProviderOrder() {
  const order = Array.isArray(config.MESSAGE_PROVIDER_ORDER)
    ? config.MESSAGE_PROVIDER_ORDER.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return order.length > 0 ? order : [String(config.MESSAGE_PROVIDER || "dev").trim()];
}

function buildRouter(marketing = false) {
  return createMessageRouter({
    order: buildProviderOrder().filter(name => !marketing || name !== "dev"),
    providers: {
      dev: createDevProvider(),
      smtp_email: createSmtpProvider({ config }),
      whatsapp_cloud: createWhatsAppCloudProvider({ config }),
      waha: createWahaProvider({ config }),
      evolution: createEvolutionProvider({ config }),
      twilio: createTwilioProvider({ config }),
      baileys: createBaileysProvider({ config })
    }
  });
}

export function marketingProviderReady() {
  return buildRouter(true).canSend({channel:"campaign",body:"",destinations:{phone:"+50255550000",email:null}});
}

export async function sendMessage({
  businessId,
  customerId = null,
  channel,
  to,
  body,
  subject = null,
  text = null,
  html = null,
  email = null,
  privilegedLog = false,
  destinations = null,
  unsubscribeUrl = null
}) {
  const marketing = ['campaign','lifecycle','churn'].includes(String(channel).toLowerCase());
  if (marketing) {
    if (!customerId) return {ok:false,suppressed:true,error:'MARKETING_CONSENT_REQUIRED'};
    const preference = await getMarketingPreference({businessId,customerId}).catch(() => null);
    const business = await BusinessRepo.getById(businessId);
    const overrides = await PlanConfigService.getPlanFeatureOverrides();
    if (!preference?.marketing_opt_in || !business || !hasPlanFeature(business.plan,'lifecycle_automation',overrides)) {
      return {ok:false,suppressed:true,error:'MARKETING_NOT_AUTHORIZED'};
    }
    if (String(channel).toLowerCase() !== 'campaign') {
      const optOutUrl = unsubscribeUrl || await issueMarketingUnsubscribeUrl({businessId,customerId});
      const line = `Dejar de recibir promociones: ${optOutUrl}`;
      body = `${body}\n\n${line}`;
      if (email) email = {...email,lines:[...(email.lines || []),line]};
    }
  }
  const logId = id();
  const safeBody = (channel === "verify" ? String(body).replace(/\b\d{6}\b/g, "******") : String(body)).replace(/(\?token=)[A-Za-z0-9_-]+/g, '$1[REDACTED]');
  const createLog = privilegedLog ? MessageLogRepo.createSecurity.bind(MessageLogRepo) : MessageLogRepo.create.bind(MessageLogRepo);
  const updateLog = privilegedLog ? MessageLogRepo.updateSecurityStatus.bind(MessageLogRepo) : MessageLogRepo.updateStatus.bind(MessageLogRepo);
  const resolvedDestinations = inferDestinations(to, destinations);
  const logTarget = String(to || resolvedDestinations.email || resolvedDestinations.phone || "").trim();
  await createLog({
    id: logId,
    business_id: businessId,
    customer_id: customerId,
    channel,
    to_addr: logTarget,
    body: safeBody,
    status: "QUEUED",
    provider_id: null,
    error: null
  });

  let sendOk = false;
  try {
    let resolvedSubject = subject;
    let resolvedText = text || body;
    let resolvedHtml = html;
    if (resolvedDestinations.email) {
      const branding = await resolveEmailBranding({
        businessId,
        getBusinessById: BusinessRepo.getById.bind(BusinessRepo)
      });
      const renderedEmail = await renderEmailMessage({
        channel,
        body,
        branding,
        email: email || (subject ? { subject } : null)
      });
      resolvedSubject = resolvedSubject || renderedEmail.subject;
      resolvedText = resolvedText || renderedEmail.text;
      resolvedHtml = resolvedHtml || renderedEmail.html;
    }

    const router = buildRouter(marketing);
    const routed = await router.send({
      channel,
      body,
      strictAcceptance: marketing,
      subject: resolvedSubject,
      text: resolvedText,
      html: resolvedHtml,
      destinations: resolvedDestinations
    });
    if (!routed?.ok) {
      if (routed?.error === "DELIVERY_UNCERTAIN") throw new Error("DELIVERY_UNCERTAIN");
      const attempts = Array.isArray(routed?.attempts) ? routed.attempts.join(",") : "";
      throw new Error(attempts ? `NO_DELIVERY_PROVIDER:${attempts}` : "NO_DELIVERY_PROVIDER");
    }
    // Acceptance is irreversible: bookkeeping errors must never tell callers to resend.
    sendOk = true;
    const providerId = /^(?:waha|evolution):[a-f0-9]{64}$/.test(routed.providerId || '')
      ? routed.providerId : `${routed.provider}:${crypto.createHash('sha256').update(String(routed.providerId || routed.provider)).digest('hex')}`;
    await updateLog(logId, { status: "SENT", provider_id: providerId, error: null })
      .catch(() => logger.warn({messageLogId:logId}, 'Accepted message log could not be updated'));
    return { ok: true, id: logId, provider: routed.provider, providerId, accepted: routed.provider !== 'dev', simulated: routed.provider === 'dev' };
  } catch (e) {
    const msg = String(e?.message || '').startsWith('NO_DELIVERY_PROVIDER') ? 'NO_DELIVERY_PROVIDER' : 'DELIVERY_UNCERTAIN';
    logger.error({ err: msg }, "sendMessage failed");
    await updateLog(logId, { status: "FAILED", error: msg, provider_id: null }).catch(() => {});
    return { ok: false, id: logId, error: msg };
  }
  finally {
    // Record usage even on failure for billing transparency
    const base = { businessId, amount: 1, unit: "count", metadata: { channel } };
    for (const eventType of ['message.attempt',sendOk ? 'message.sent' : 'message.failed']) {
      await emitBillingEvent({ ...base, eventType }).catch(() => logger.warn({messageLogId:logId,eventType}, 'Message billing event could not be recorded'));
    }
  }
}

export function verificationBody({ businessName, code }) {
  return `PuntosFieles • ${businessName}\n\nTu código es: ${code}\nVence en 10 minutos.`;
}

export function churnBody({ businessName }) {
  return `¡Te extrañamos en ${businessName}! Tu programa de puntos sigue disponible. Consulta tus beneficios antes de tu próxima visita.`;
}
