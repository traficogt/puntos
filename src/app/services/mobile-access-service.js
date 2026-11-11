import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { runWithDbContext, withTransaction } from '../database.js';
import { MobileAccessRepo } from '../repositories/mobile-access-repository.js';
import { createBrowserSession, hashSessionToken } from './auth-session-service.js';
import { sendMessage } from './messaging-service.js';
import { normalizePhone } from '../../utils/phone.js';
import { random6 } from '../../utils/random-code.js';
import { badRequest, HttpError, tooManyRequests, unauthorized } from '../../utils/http-error.js';

const customerFields = ['id', 'name', 'phone', 'points', 'pending_points', 'lifetime_points'];
const invalidCredential = () => unauthorized('Código o acceso inválido o vencido. Solicita un código nuevo.');
function verifiedPhone(value) {
  if (typeof value !== 'string' || value.length > 30 || !/^[+\d\s()-]+$/.test(value)) throw badRequest('Teléfono inválido');
  const phone = normalizePhone(value);
  if (!/^\d{8,15}$/.test(phone)) throw badRequest('Teléfono inválido');
  return phone;
}
const defaults = { repo: MobileAccessRepo, runWithDbContext, withTransaction, createBrowserSession, sendMessage };

export function createMobileAccessService(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  // Discard all request context, including caller-supplied tenant identity. A new
  // transaction owns these settings and clears them when its client is released.
  const transaction = fn => deps.runWithDbContext({ tenantId: null, platformAdmin: true, webhookIngest: false }, () => deps.withTransaction(fn));

  async function signIn(membership, client) {
    const { customer, business } = membership;
    const { token, session } = await deps.createBrowserSession({
      actorType: 'CUSTOMER', actorId: customer.id, businessId: business.id,
      meta: { business_slug: business.slug }
    }, client.query.bind(client));
    return {
      status: 'signed_in', token, expiresAt: new Date(session.absolute_expires_at).toISOString(),
      customer: Object.fromEntries(customerFields.map(key => [key, customer[key]])), business
    };
  }

  return {
    async requestCode({ phone: input }) {
      const phone = verifiedPhone(input);
      const code = random6();
      const codeHash = await bcrypt.hash(code, 10);
      const id = crypto.randomUUID();
      await transaction(async () => {
        await deps.repo.lockPhone(phone);
        const counts = await deps.repo.requestCounts(phone);
        if (counts.minute >= 1 || counts.hour >= 5) throw tooManyRequests('Espera antes de solicitar otro código.');
        await deps.repo.createCode({ id, phone, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60 * 1000) });
      });
      // Delivery is identical for every valid phone, including phones with no
      // cards. No membership query or unverified email fallback occurs here.
      let sent;
      try {
        sent = await deps.sendMessage({ businessId: null, customerId: null, privilegedLog: true,
          channel: 'verify', to: phone, destinations: { phone },
          body: `Tu código de PuntosFieles: ${code} (expira en 10 minutos)` });
      } catch { sent = { ok: false }; }
      if (!sent?.ok) {
        await transaction(() => deps.repo.invalidateCode(id));
        throw new HttpError(503, 'No se pudo enviar el código. Intenta de nuevo en unos minutos.');
      }
      return { ok: true };
    },

    async verify({ phone: input, code }) {
      const phone = verifiedPhone(input);
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalidCredential();
      const result = await transaction(async client => {
        await deps.repo.lockPhone(phone);
        const record = await deps.repo.latestCode(phone);
        if (!record) return { error: invalidCredential() };
        if (!await bcrypt.compare(code, record.code_hash)) {
          await deps.repo.failCode(record.id);
          // Return instead of throwing so the failed-attempt increment commits.
          return { error: invalidCredential() };
        }
        if (!await deps.repo.consumeCode(record.id)) return { error: invalidCredential() };
        const cards = await deps.repo.listCards(phone);
        if (!cards.length) return { status: 'no_cards' };
        if (cards.length === 1) {
          const membership = await deps.repo.getMembership(phone, cards[0].id);
          return membership ? signIn(membership, client) : { status: 'no_cards' };
        }
        const accessToken = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        await deps.repo.createGrant({ id: crypto.randomUUID(), token_hash: hashSessionToken(accessToken), phone, expires_at: expiresAt });
        return { status: 'choose_card', accessToken, expiresAt, cards };
      });
      if (result.error) throw result.error;
      return result;
    },

    async select({ accessToken, businessId }) {
      if (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) throw invalidCredential();
      const result = await transaction(async client => {
        const grant = await deps.repo.lockGrant(hashSessionToken(accessToken));
        if (!grant) return { error: invalidCredential() };
        const membership = await deps.repo.getMembership(grant.phone, businessId);
        if (!membership || !await deps.repo.consumeGrant(grant.id)) return { error: invalidCredential() };
        return signIn(membership, client);
      });
      if (result.error) throw result.error;
      return result;
    }
  };
}

export const mobileAccessService = createMobileAccessService();
