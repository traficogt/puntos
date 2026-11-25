import nodemailer from "nodemailer";
import { MessageProviderError, providerTimeoutMs } from "./http-provider.js";

/** @typedef {import("../message-router.js").RoutedMessage} RoutedMessage */
/**
 * @typedef {{
 *   SMTP_HOST?: string,
 *   SMTP_PORT?: number,
 *   SMTP_SECURE?: string,
 *   SMTP_USER?: string,
 *   SMTP_PASS?: string,
 *   SMTP_FROM?: string,
 *   MESSAGE_PROVIDER_TIMEOUT_MS?: unknown,
 * }} SmtpConfig
 */
/**
 * Transport options handed to nodemailer (or to a test transport factory).
 * @typedef {{
 *   host: string | undefined,
 *   port: number | undefined,
 *   secure: boolean,
 *   connectionTimeout: number,
 *   greetingTimeout: number,
 *   socketTimeout: number,
 *   ignoreTLS?: boolean,
 *   requireTLS?: boolean,
 *   auth?: { user: string | undefined, pass: string | undefined },
 * }} SmtpTransportOptions
 */
/** @typedef {{ from: string | undefined, to: string, subject: string | undefined, text: string, html?: string }} SmtpMail */
/** @typedef {{ messageId?: string, accepted?: unknown[], rejected?: unknown[] }} SmtpSendInfo */
/** @typedef {{ sendMail(message: SmtpMail): Promise<SmtpSendInfo> }} SmtpTransport */

/** @param {SmtpConfig} config */
function resolveSecure(config) {
  if (config.SMTP_SECURE === "true") return true;
  if (config.SMTP_SECURE === "false") return false;
  return Number(config.SMTP_PORT) === 465;
}

/** @param {SmtpConfig} config */
function resolveTransportSecurity(config) {
  if (config.SMTP_SECURE === "false") {
    return {
      // Explicit plaintext SMTP for local relays that advertise STARTTLS with
      // certificates that do not match their private IPs.
      ignoreTLS: true,
      requireTLS: false,
    };
  }
  return {};
}

/**
 * Only the sendMail capability is required; tests can supply an isolated transport.
 * @param {{ config: SmtpConfig, transportFactory?: (options: SmtpTransportOptions) => SmtpTransport }} options
 */
export function createSmtpProvider({ config, transportFactory = nodemailer.createTransport }) {
  return {
    name: "smtp_email",
    /** @param {Pick<RoutedMessage, "destinations">} message */
    canSend({ destinations }) {
      return Boolean(destinations?.email && config.SMTP_HOST);
    },
    /** @param {Omit<import("../message-router.js").RoutedMessage, "channel"> & { channel?: string }} message */
    async send({
      destinations,
      body,
      subject = "PuntosFieles",
      text = body,
      html = "",
      strictAcceptance = false,
    }) {
      const transport = transportFactory({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: resolveSecure(config),
        connectionTimeout: providerTimeoutMs(config.MESSAGE_PROVIDER_TIMEOUT_MS),
        greetingTimeout: providerTimeoutMs(config.MESSAGE_PROVIDER_TIMEOUT_MS),
        socketTimeout: providerTimeoutMs(config.MESSAGE_PROVIDER_TIMEOUT_MS),
        ...resolveTransportSecurity(config),
        ...(config.SMTP_USER || config.SMTP_PASS
          ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
          : {}),
      });
      const info = await transport.sendMail({
        from: config.SMTP_FROM,
        // canSend admits only messages with an e-mail destination.
        to: /** @type {string} */ (destinations.email),
        subject: subject ?? undefined,
        text: String(text || body || ""),
        ...(html ? { html } : {}),
      });
      if (strictAcceptance && !info?.accepted?.length) {
        throw new MessageProviderError(
          info?.rejected?.length ? "MESSAGE_PROVIDER_REJECTED" : "MESSAGE_DELIVERY_UNCERTAIN",
          !info?.rejected?.length,
        );
      }
      return { ok: true, providerId: info?.messageId ?? "smtp" };
    },
  };
}
