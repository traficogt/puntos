import { SELECTION_PROMPT_COPY } from "./page-context.js";

/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Program-rule presentation: the active (or protected-cycle) rule summary, the
 * inputs each program type needs, and the live award preview.
 * @param {StaffPageContext} ctx
 */
export function createProgramRules(ctx) {
  const { state, element, input } = ctx;

  function effectiveRule() {
    return state.protectedCycle
      ? {
          ...state.programRule,
          program_type: state.protectedCycle.program_type,
          program_json: state.protectedCycle.earning_terms,
        }
      : state.programRule;
  }

  function renderProgramInfo() {
    const el = element("#programInfo");
    if (!el || !state.programRule) return;
    const { programRule, protectedCycle } = state;
    const effective = effectiveRule();
    const cfg = effective.program_json || {};
    const mode = protectedCycle ? "protegida" : "activa";
    const currency = programRule.region?.currency || "GTQ";
    if (effective.program_type === "SPEND") {
      el.textContent =
        cfg.points_per_q == null
          ? "Regla pendiente: el dueño debe configurar la regla de puntos antes de registrar compras."
          : `Regla ${mode}: Por gasto (${currency}). Tasa ${Number(cfg.points_per_q)} pts/${currency} (${cfg.round || "ceil"}).`;
    } else if (effective.program_type === "VISIT") {
      el.textContent = `Regla ${mode}: Por visita (${Number(cfg.points_per_visit ?? 0)} pts por visita).`;
    } else if (effective.program_type === "DISCOUNT") {
      el.textContent = `Regla ${mode}: Descuento de miembro ${Number(cfg.percent_off ?? 0)}% en cada compra (sin puntos).`;
    } else if (effective.program_type === "STAMP") {
      const req = Math.max(2, Math.floor(Number(cfg.stamps_required) || 0) || 10);
      const hs = Math.min(req - 1, Math.max(0, Math.floor(Number(cfg.head_start) || 0)));
      const prize =
        typeof cfg.reward_label === "string" && cfg.reward_label.trim()
          ? cfg.reward_label.trim()
          : "Premio";
      const per = cfg.stamp_unit === "item" ? "artículo" : "visita";
      el.textContent = `Regla ${mode}: Tarjeta de sellos — ${req} sellos para ${prize}${hs > 0 ? `, empieza con ${hs} de regalo` : ""} (1 sello por ${per}).`;
    } else if (effective.program_type === "CASHBACK") {
      el.textContent = `Regla ${mode}: Cashback — gana ${Number(cfg.cashback_percent ?? 0)}% de cada compra como saldo (sin puntos).`;
    } else if (effective.program_type === "GIFT_CARD") {
      const bonus = Number(cfg.load_bonus_percent ?? 0);
      el.textContent = `Regla ${mode}: Tarjeta de regalo — el cliente recarga saldo${bonus > 0 ? ` (bono ${bonus}%)` : ""} y puede regalarlo a otro miembro. No otorga puntos.`;
    } else {
      el.textContent = `Regla ${mode}: Por item (${Number(cfg.points_per_item ?? 1)} pts por item).`;
    }
  }

  function updateInputsForRule() {
    const { programRule, protectedCycle } = state;
    if (!programRule) return;
    const t = protectedCycle?.program_type || programRule.program_type;
    const currency = programRule.region?.currency || "GTQ";
    element("#staffAmountLabel").textContent = `Monto (${currency})`;
    element("#staffGiftAmountLabel").textContent = `Monto a descontar (${currency})`;
    input("#amount").step = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    input("#giftAmount").step = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    input("#giftAmount").min = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    const stampCfg =
      (protectedCycle ? protectedCycle.earning_terms : programRule.program_json) || {};
    const stampVisit = t === "STAMP" && stampCfg.stamp_unit !== "item";
    const stampItem = t === "STAMP" && stampCfg.stamp_unit === "item";
    input("#amount").disabled = t !== "SPEND" && t !== "DISCOUNT" && t !== "CASHBACK";
    input("#visits").disabled = t !== "VISIT" && !stampVisit;
    input("#items").disabled = t !== "ITEM" && !stampItem;
    updateAwardPreview();
  }

  function updateAwardPreview() {
    const out = element("#awardPreview");
    const { programRule } = state;
    if (!out || !programRule) return;
    if (!state.lastCustomerId) {
      out.textContent = SELECTION_PROMPT_COPY;
      return;
    }
    const effective = effectiveRule();
    const cfg = effective.program_json || {};
    const amount = Number(input("#amount").value || 0);
    const visits = Math.floor(Number(input("#visits").value || 0));
    const items = Math.floor(Number(input("#items").value || 0));
    const digits = programRule.region?.minorUnits === 0 ? 0 : 2;
    const currency = programRule.region?.currency || "GTQ";
    let preview = 0;

    if (effective.program_type === "DISCOUNT") {
      const pct = Math.min(100, Math.max(0, Number(cfg.percent_off ?? 0)));
      const discount = Math.round(amount * pct) / 100;
      out.textContent =
        pct > 0
          ? `Descuento de miembro: ${currency} ${discount.toFixed(digits)} (${pct}% de ${currency} ${amount.toFixed(digits)}). No otorga puntos.`
          : "Descuento de miembro no configurado todavía.";
      return;
    }
    if (effective.program_type === "CASHBACK") {
      const pct = Math.min(100, Math.max(0, Number(cfg.cashback_percent ?? 0)));
      const earn = Math.round(amount * pct) / 100;
      out.textContent =
        pct > 0
          ? `Cashback: ${currency} ${earn.toFixed(digits)} (${pct}% de ${currency} ${amount.toFixed(digits)}) como saldo. No otorga puntos.`
          : "Cashback no configurado todavía.";
      return;
    }
    if (effective.program_type === "GIFT_CARD") {
      out.textContent =
        "Tarjeta de regalo: usa «Recargar saldo» o «Usar saldo». Registrar una compra no otorga puntos ni saldo.";
      return;
    }
    if (effective.program_type === "STAMP") {
      const unitCount = cfg.stamp_unit === "item" ? items || 1 : visits || 1;
      const n = Math.max(1, Math.floor(unitCount));
      out.textContent = `Vista previa: se otorgará ${n} ${n === 1 ? "sello" : "sellos"} con los valores actuales.`;
      return;
    }
    if (effective.program_type === "VISIT") {
      preview = Math.max(0, (visits || 1) * Number(cfg.points_per_visit ?? 10));
    } else if (effective.program_type === "ITEM") {
      preview = Math.max(0, (items || 1) * Number(cfg.points_per_item ?? 0));
    } else {
      const rate = Number(cfg.points_per_q ?? 0); // unconfigured rule previews 0; the server refuses the award
      const raw = amount * rate;
      const round = String(cfg.round ?? "ceil");
      preview =
        round === "floor" ? Math.floor(raw) : round === "round" ? Math.round(raw) : Math.ceil(raw);
    }
    out.textContent = `Vista previa: se otorgarán aprox. ${Math.max(0, preview)} puntos con los valores actuales.`;
  }

  function bind() {
    input("#amount").addEventListener("input", updateAwardPreview);
    input("#visits").addEventListener("input", updateAwardPreview);
    input("#items").addEventListener("input", updateAwardPreview);
  }

  return { bind, renderProgramInfo, updateAwardPreview, updateInputsForRule };
}
