#!/usr/bin/env node

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

/**
 * @param {string[]} argv
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function arg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

/**
 * @param {string[]} argv
 * @returns {{
 *   actorType: string,
 *   target: string,
 *   staffId: string,
 *   email: string,
 *   customerId: string
 * }}
 */
export function parseMagicLinkArgs(argv) {
  return {
    actorType: String(arg(argv, "--actor")).trim().toLowerCase(),
    target: String(arg(argv, "--target")).trim(),
    staffId: String(arg(argv, "--staff-id")).trim(),
    email: String(arg(argv, "--email")).trim(),
    customerId: String(arg(argv, "--customer-id")).trim()
  };
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {{ actorType: string, target: string, staffId: string, email: string, customerId: string }} args
 */
function validateMagicLinkArgs(args) {
  assert(["staff", "customer"].includes(args.actorType), "Debes indicar --actor staff o --actor customer.");
  assert(["staff", "admin-dashboard", "customer-wallet"].includes(args.target), "Debes indicar un --target válido.");

  if (args.actorType === "staff") {
    assert(!args.customerId, "Un actor staff no puede usar --customer-id.");
    assert(!(args.staffId && args.email), "Usa solo --staff-id o --email para staff, no ambos.");
    assert(Boolean(args.staffId || args.email), "Debes indicar --staff-id o --email para staff.");
    assert(["staff", "admin-dashboard"].includes(args.target), "Un actor staff no puede usar ese destino.");
    return;
  }

  assert(!args.staffId, "Un actor customer no puede usar --staff-id.");
  assert(!args.email, "Un actor customer no puede usar --email.");
  assert(Boolean(args.customerId), "Debes indicar --customer-id para customer.");
  assert(args.target === "customer-wallet", "Un actor customer no puede usar ese destino.");
}

/**
 * @param {{ actorType: string, staffId: string, email: string, customerId: string }} args
 * @param {{
 *   StaffRepo?: { getById(id: string): Promise<unknown>, getByEmail(email: string): Promise<unknown> },
 *   CustomerRepo?: { getById(id: string): Promise<unknown> }
 * }} deps
 * @returns {Promise<unknown>}
 */
export async function resolveMagicLinkActor(args, deps) {
  if (args.actorType === "staff") {
    const actor = args.staffId
      ? await deps.StaffRepo.getById(args.staffId)
      : await deps.StaffRepo.getByEmail(args.email);
    assert(actor, "No se encontró el usuario indicado.");
    return actor;
  }

  const actor = await deps.CustomerRepo.getById(args.customerId);
  assert(actor, "No se encontró el cliente indicado.");
  return actor;
}

/**
 * @param {{ url: string, usageMode: string, expiresAt: string }} result
 * @returns {string}
 */
export function formatMagicLinkOutput(result) {
  return [
    `url: ${result.url}`,
    `usage_mode: ${result.usageMode}`,
    `expires_at: ${result.expiresAt}`
  ].join("\n");
}

async function loadDefaultDeps() {
  const [
    { config },
    { withDbClientContext, closeDatabase },
    { buildInternalMagicLink },
    { StaffRepo },
    { CustomerRepo }
  ] = await Promise.all([
    import("../config/index.js"),
    import("../app/database.js"),
    import("../app/services/internal-magic-link-service.js"),
    import("../app/repositories/staff-repository.js"),
    import("../app/repositories/customer-repository.js")
  ]);

  return {
    config,
    withDbClientContext,
    closeDatabase,
    buildInternalMagicLink,
    StaffRepo,
    CustomerRepo
  };
}

/**
 * @param {{
 *   argv?: string[],
 *   config?: { APP_ORIGIN?: string, PUBLIC_WEB_ORIGIN?: string },
 *   withDbClientContext?: (ctx: { platformAdmin?: boolean, tenantId?: string | null }, fn: () => Promise<unknown>) => Promise<unknown>,
 *   closeDatabase?: () => Promise<unknown>,
 *   buildInternalMagicLink?: (payload: {
 *     actorType: string,
 *     actor: unknown,
 *     target: string,
 *     createdBy: string,
 *     origin: string
 *   }) => Promise<{ url: string, usageMode: string, expiresAt: string }>,
 *   StaffRepo?: { getById(id: string): Promise<unknown>, getByEmail(email: string): Promise<unknown> },
 *   CustomerRepo?: { getById(id: string): Promise<unknown> }
 * }} [options]
 * @returns {Promise<string>}
 */
export async function createMagicLinkCli(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const parsed = parseMagicLinkArgs(argv);
  validateMagicLinkArgs(parsed);

  const defaultDeps = options.config ? {} : await loadDefaultDeps();
  const deps = {
    ...defaultDeps,
    ...options
  };

  assert(deps.config, "Falta configuración de ejecución.");
  assert(typeof deps.withDbClientContext === "function", "Falta el contexto de base de datos.");
  assert(typeof deps.closeDatabase === "function", "Falta el cierre de base de datos.");
  assert(typeof deps.buildInternalMagicLink === "function", "Falta el servicio de magic links.");
  assert(deps.StaffRepo && typeof deps.StaffRepo.getById === "function" && typeof deps.StaffRepo.getByEmail === "function", "Falta el repositorio de staff.");
  assert(deps.CustomerRepo && typeof deps.CustomerRepo.getById === "function", "Falta el repositorio de clientes.");

  try {
    /** @type {{ StaffRepo: { getById(id: string): Promise<unknown>, getByEmail(email: string): Promise<unknown> }, CustomerRepo: { getById(id: string): Promise<unknown> } }} */
    const actorDeps = {
      StaffRepo: deps.StaffRepo,
      CustomerRepo: deps.CustomerRepo
    };
    const output = await deps.withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const actor = await resolveMagicLinkActor(parsed, actorDeps);
      const link = await deps.buildInternalMagicLink({
        actorType: parsed.actorType,
        actor,
        target: parsed.target,
        createdBy: "terminal",
        origin: deps.config.APP_ORIGIN || deps.config.PUBLIC_WEB_ORIGIN
      });
      return formatMagicLinkOutput(link);
    });
    return String(output);
  } finally {
    await Promise.resolve(deps.closeDatabase()).catch(() => {});
  }
}

async function main() {
  const output = await createMagicLinkCli();
  console.log(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
