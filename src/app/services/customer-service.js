import { normalizeEnrollmentPhone } from "./regional-phone.js";
import crypto from "node:crypto";
import { AcquisitionService } from "./acquisition-service.js";
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
import { withDbClientContext, withTransaction } from "../database.js";

function id() { return crypto.randomUUID(); }

async function ensureRateLimits(repo, businessId, phone) {
  const recent = await repo.countRecent(businessId, phone, "60 seconds");
  if (recent >= 1) throw tooManyRequests("Please wait before requesting another code");
  const hour = await repo.countRecent(businessId, phone, "1 hour");
  if (hour >= 5) throw tooManyRequests("Too many verification codes requested");
}

async function lockVerification(client, businessId, phone) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [String(businessId), String(phone)]);
}

export async function requestJoinCodeWithDeps(deps, { business, phone, email: _email = null, name: _name, requireExisting = false }) {
  if (!business?.id) throw notFound("Negocio no encontrado");
  if (!phone) throw badRequest("Falta el teléfono");
  phone = normalizeEnrollmentPhone(phone, business);

  return deps.withDbClientContext({ tenantId: business.id, platformAdmin: false }, async () => {
    const { code, verifyCodeId } = await deps.withTransaction(async client => {
      await lockVerification(client, business.id, phone);
      const existingCustomer = await deps.CustomerRepo.getByBusinessAndPhone(business.id, phone);
      if (requireExisting && !existingCustomer) throw notFound("No encontramos una tarjeta con ese teléfono en este negocio.");
      await ensureRateLimits(deps.VerifyCodeRepo, business.id, phone);
      const code = random6();
      const verifyCodeId = id();
      await deps.VerifyCodeRepo.create({
        id: verifyCodeId,
        business_id: business.id,
        phone,
        code_hash: await bcrypt.hash(code, 10),
        expires_at: new Date(Date.now() + 10 * 60 * 1000)
      });
      return { code, verifyCodeId };
    });

    const sent = await deps.sendMessage({
      businessId: business.id,
      customerId: null,
      channel: "verify",
      to: phone,
      // An email submitted at login does not prove ownership of this phone.
      // Email fallback requires a verified account binding, which does not exist here.
      destinations: { phone },
      body: `Tu código de PuntosFieles: ${code} (expira en 10 minutos)`,
      email: {
        type: "verify",
        businessName: business.name,
        code,
        expiresText: "Vence en 10 minutos."
      }
    });
    if (!sent?.ok) {
      await deps.VerifyCodeRepo.invalidateById(verifyCodeId);
      const err = new Error("No se pudo enviar el código por los canales disponibles. Intenta de nuevo en unos minutos.");
      // @ts-ignore custom status
      err.statusCode = 503;
      throw err;
    }

    const dev = config.MESSAGE_PROVIDER === "dev" && config.NODE_ENV !== "production";
    return { ok: true, dev_code: dev ? code : undefined };
  });
}

export async function verifyJoinCodeWithDeps(deps, { business, phone, code, name, referralCode, requireExisting = false, visitToken = null }) {
  if (!business?.id) throw notFound("Negocio no encontrado");
  if (!phone) throw badRequest("Falta el teléfono");
  phone = normalizeEnrollmentPhone(phone, business);
  if (!code) throw badRequest("Falta el código");

  return deps.withDbClientContext({ tenantId: business.id, platformAdmin: false }, async () => {
    const result = await deps.withTransaction(async client => {
      await lockVerification(client, business.id, phone);
      const vc = await deps.VerifyCodeRepo.latestValid(business.id, phone);
      if (!vc) throw badRequest("No hay un código válido. Solicita uno nuevo.");

      const ok = await bcrypt.compare(String(code).trim(), vc.code_hash);
      if (!ok) {
        await deps.VerifyCodeRepo.markFailedAttempt(vc.id);
        // Commit the failed attempt before returning the authentication error.
        return { error: unauthorized("Código inválido") };
      }

      let customer = await deps.CustomerRepo.getByBusinessAndPhone(business.id, phone);
      if (requireExisting && !customer) {
        throw notFound("No encontramos una tarjeta con ese teléfono en este negocio.");
      }
      let isNewCustomer = !customer;

      if (!customer) {
        const newCustomerId = id();
        customer = await deps.CustomerRepo.create({
          id: newCustomerId,
          business_id: business.id,
          phone,
          name: name ? String(name).slice(0, 120) : null
        });
        // Another entry path may have created the same phone while this request was verifying.
        isNewCustomer = customer.id === newCustomerId;
      } else if (name && !customer.name) {
        await deps.CustomerRepo.updateName(customer.id, String(name).slice(0, 120));
      }

      if (!await deps.VerifyCodeRepo.consume(vc.id)) throw badRequest("No hay un código válido. Solicita uno nuevo.");
      if (visitToken && deps.recordAcquisition) {
        await client.query("SAVEPOINT acquisition_signup");
        try {
          await deps.recordAcquisition(client, { businessId: business.id, customerId: customer.id, visitToken, isNewCustomer });
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT acquisition_signup");
          logger.warn({ code: err?.code || "ACQUISITION_UNAVAILABLE" }, "Acquisition attribution unavailable; verified registration continues");
        }
        await client.query("RELEASE SAVEPOINT acquisition_signup");
      }
      return { customer, isNewCustomer };
    });
    if (result.error) throw result.error;
    const { customer, isNewCustomer } = result;

    if (isNewCustomer) {
      await deps.withDbClientContext({ tenantId: business.id, platformAdmin: false }, async () => {
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

    const token = await deps.signCustomerToken({ cid: customer.id, bid: business.id, slug: business.slug });
    return { customer, token };
  });
}

const customerDeps = { CustomerRepo, VerifyCodeRepo, withDbClientContext, withTransaction, sendMessage, signCustomerToken, recordAcquisition: AcquisitionService.attributeVerified };

export function requestJoinCode(input) {
  return requestJoinCodeWithDeps(customerDeps, input);
}

export function verifyJoinCode(input) {
  return verifyJoinCodeWithDeps(customerDeps, input);
}

export async function issueCustomerQr({ businessId, customerId }) {
  const ttl = 5 * 60; // 5 minutes
  const out = await signQrToken(businessId, customerId, ttl);
  return out;
}
