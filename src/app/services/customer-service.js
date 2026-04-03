import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { VerifyCodeRepo } from "../repositories/verify-code-repository.js";
import { signCustomerToken } from "../../utils/auth-token.js";
import { random6 } from "../../utils/random-code.js";
import { sendMessage } from "./messaging-service.js";
import { config } from "../../config/index.js";
import { signQrToken } from "../../utils/qr-token.js";
import { badRequest, notFound, tooManyRequests, unauthorized } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { withDbClientContext } from "../database.js";

function id() { return crypto.randomUUID(); }

function ignore(promise) {
  return promise.catch(() => {});
}

async function ensureRateLimits(businessId, phone) {
  const recent = await VerifyCodeRepo.countRecent(businessId, phone, "60 seconds");
  if (recent >= 1) throw tooManyRequests("Please wait before requesting another code");
  const hour = await VerifyCodeRepo.countRecent(businessId, phone, "1 hour");
  if (hour >= 5) throw tooManyRequests("Too many verification codes requested");
}

export async function requestJoinCode({ business, phone, email = null, name, requireExisting = false }) {
  if (!business?.id) throw notFound("Negocio no encontrado");
  if (!phone) throw badRequest("Falta el teléfono");

  const existingCustomer = await CustomerRepo.getByBusinessAndPhone(business.id, phone);
  if (requireExisting && !existingCustomer) {
    throw notFound("No encontramos una tarjeta con ese teléfono en este negocio.");
  }

  await ensureRateLimits(business.id, phone);

  const code = random6();
  const verifyCodeId = id();
  const code_hash = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  await VerifyCodeRepo.create({
    id: verifyCodeId,
    business_id: business.id,
    phone,
    code_hash,
    expires_at: expires
  });

  const sent = await sendMessage({
    businessId: business.id,
    customerId: null,
    channel: "verify",
    to: phone,
    destinations: { phone, email },
    body: `Tu código de PuntosFieles: ${code} (expira en 10 minutos)`
  });
  if (!sent?.ok) {
    await ignore(VerifyCodeRepo.deleteById(verifyCodeId));
    const err = new Error("No se pudo enviar el código por los canales disponibles. Intenta de nuevo en unos minutos.");
    // @ts-ignore custom status
    err.statusCode = 503;
    throw err;
  }

  // Optionally store the name on an existing customer (best effort)
  if (name) {
    if (existingCustomer && !existingCustomer.name) {
      await ignore(CustomerRepo.updateName(existingCustomer.id, String(name).slice(0, 120)));
    }
  }

  const dev = config.MESSAGE_PROVIDER === "dev" && config.NODE_ENV !== "production";
  return { ok: true, dev_code: dev ? code : undefined };
}

export async function verifyJoinCode({ business, phone, code, name, referralCode, requireExisting = false }) {
  if (!business?.id) throw notFound("Negocio no encontrado");
  if (!phone) throw badRequest("Falta el teléfono");
  if (!code) throw badRequest("Falta el código");

  const vc = await VerifyCodeRepo.latestValid(business.id, phone);
  if (!vc) throw badRequest("No hay un código válido. Solicita uno nuevo.");

  const ok = await bcrypt.compare(String(code).trim(), vc.code_hash);
  if (!ok) {
    await ignore(VerifyCodeRepo.markFailedAttempt(vc.id));
    throw unauthorized("Código inválido");
  }

  let customer = await CustomerRepo.getByBusinessAndPhone(business.id, phone);
  if (requireExisting && !customer) {
    throw notFound("No encontramos una tarjeta con ese teléfono en este negocio.");
  }
  const isNewCustomer = !customer;
  
  if (!customer) {
    customer = await CustomerRepo.create({
      id: id(),
      business_id: business.id,
      phone,
      name: name ? String(name).slice(0, 120) : null
    });
  } else if (name && !customer.name) {
    await ignore(CustomerRepo.updateName(customer.id, String(name).slice(0, 120)));
  }

  await VerifyCodeRepo.deleteById(vc.id);

  if (isNewCustomer) {
    withDbClientContext({ tenantId: business.id, platformAdmin: false }, async () => {
      try {
        const { TierService } = await import("./tier-service.js");
        await TierService.getCustomerTierInfo(customer.id);
      } catch (err) {
        logger.warn({ err: err?.message || err, customerId: customer.id }, "Tier initialization failed");
      }

      try {
        if (referralCode) {
          const { ReferralService } = await import("./referral-service.js");
          await ReferralService.applyReferralCode(referralCode, customer.id, business.id);
        }
      } catch (err) {
        logger.warn({ err: err?.message || err, customerId: customer.id }, "Referral code application failed");
      }

      try {
        const { GamificationService } = await import("./gamification-service.js");
        await GamificationService.checkAndAwardAchievements(customer.id, "signup");
      } catch (err) {
        logger.warn({ err: err?.message || err, customerId: customer.id }, "Achievement check failed");
      }
    }).catch((err) => {
      logger.warn({ err: err?.message || err, customerId: customer.id }, "Post-join hooks failed");
    });
  }

  const token = await signCustomerToken({ cid: customer.id, bid: business.id, slug: business.slug });
  return { customer, token };
}

export async function issueCustomerQr({ businessId, customerId }) {
  const ttl = 5 * 60; // 5 minutes
  const out = await signQrToken(businessId, customerId, ttl);
  return out;
}
