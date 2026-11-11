import { mountRewardEntitlements } from "./reward-entitlements.js";
import { mountPosRecording } from "./pos-recording.js";
import { addAward as storeAward, deleteAward as removeAward, getAwardQueueStats, requeueSyncingAwards, updateAward, listAwards as listStoredAwards } from "/idb.js";
import { registerServiceWorker, setHidden } from "/lib.js";
import { createAwardQueue } from "./award-queue.js";
import { mountServiceCases } from "./service-cases.js";
import { mountServiceBriefing } from "./service-briefing.js";

/** @typedef {import("./types.js").StaffAwardResponse} StaffAwardResponse */
/** @typedef {import("./types.js").StaffGiftRedeemResponse} StaffGiftRedeemResponse */
/** @typedef {import("./types.js").StaffLookupCustomerResponse} StaffLookupCustomerResponse */
/** @typedef {import("./types.js").StaffMeResponse} StaffMeResponse */
/** @typedef {import("./types.js").StaffPermissionsResponse} StaffPermissionsResponse */
/** @typedef {import("./types.js").StaffProgramRule} StaffProgramRule */
/** @typedef {import("./types.js").StaffRedeemResponse} StaffRedeemResponse */
/** @typedef {import("./types.js").StaffRewardsResponse} StaffRewardsResponse */
/** @typedef {import("./types.js").StaffSyncResponse} StaffSyncResponse */

/** @param {{ api: any, $: any, toast: any, uuidv4: any, addAward?: Function, listAwards?: Function, deleteAward?: Function }} options */
export async function initStaffPage({ api, $, toast, uuidv4 }) {
  /** @type {import("./types.js").StaffProfile | null} */
  let staff = null;
  let serviceCases = null;
  let rewardEntitlements = null;
  let posRecording = null;
  let protectedCycle = null;
  let serviceBriefing = null;
  let scanning = false;
  let lastCustomerId = null;
  let lastCustomerToken = "";
  let lastCustomerPoints = 0;
  let detector = null;
  let lastScannedToken = "";
  let lastScannedAt = 0;
  let redeemInFlight = false;
  let giftRedeemInFlight = false;
  let awardInFlight = false;
  let unverifiedSelection = false;
  let storageFailed = false;
  let sessionEnded = false;
  let authFlight = null;
  let offlineGrant = null;
  let sessionOnline = false;
  let logoutPending = false;
  let logoutFlight = null;
  /** @type {StaffProgramRule | null} */
  let programRule = null;
  /** @type {StaffRewardsResponse["rewards"]} */
  let rewardOptions = [];
  /** @type {Set<string> | null} */
  let permissionSet = null;
  /** @type {Record<string, boolean>} */
  let planFeatures = {};
  let lastCustomerMovement = "Sin movimientos recientes";
  const selectionPromptCopy = "Escanea o ingresa el código del cliente para continuar.";
  const queue = createAwardQueue({
    store: { addAward: storeAward, listAwards: listStoredAwards, updateAward, deleteAward: removeAward },
    api,
    canSend: () => sessionOnline && !sessionEnded,
    authenticate: async (permission) => {
      if (!await ensureAuth() || !hasPerm(permission)) return null;
      if (!navigator.onLine && !hasOfflineGrant()) return null;
      if (permission === "staff.sync" && !sessionOnline) return null;
      return currentScope();
    },
    onChange: refreshQueue,
    withLock: (scope, fn) => navigator.locks?.request
      ? navigator.locks.request(`pf-awards:${scope.businessId}:${scope.staffId}`, fn)
      : fn()
  });

  function currentScope() {
    return staff?.id && staff?.business_id ? { businessId: staff.business_id, staffId: staff.id } : null;
  }

  function hasOfflineGrant() {
    return !sessionEnded && typeof offlineGrant?.grant === "string" && Date.parse(offlineGrant.expiresAt) > Date.now();
  }

  function isAuthError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return error?.status === 401 || error?.status === 403 || code === "AUTH_REQUIRED"
      || code === "AUTH_INVALID_TOKEN"
      || code === "FORBIDDEN"
      || /No autenticado|Token invalido|No autorizado|no auth/i.test(message);
  }

  function isNetworkFailure(error) {
    if (error?.status || error?.code) return false;
    const message = String(error?.message || "");
    return !navigator.onLine || /NetworkError|Failed to fetch|fetch|abort/i.test(message);
  }

  function readOfflineSnapshot() {
    try {
      const raw = localStorage.getItem("pf_staff_snapshot");
      const snapshot = raw ? JSON.parse(raw) : null;
      return snapshot?.staff?.id && snapshot?.staff?.business_id && Date.now() - Date.parse(snapshot.updatedAt) < 86400000 ? snapshot : null;
    } catch {
      return null;
    }
  }

  function writeOfflineSnapshot() {
    try {
      localStorage.setItem("pf_staff_snapshot", JSON.stringify({
        staff,
        permissions: permissionSet ? [...permissionSet] : [],
        planFeatures,
        programRule,
        offlineGrant,
        updatedAt: new Date().toISOString()
      }));
    } catch {}
  }

  function clearOfflineSnapshot() {
    try {
      localStorage.removeItem("pf_staff_snapshot");
    } catch {}
  }

  function hasPendingLogout() {
    try { return logoutPending || localStorage.getItem("pf_staff_logout_pending") === "1"; }
    catch { return logoutPending; }
  }

  function blockLocalSession() {
    serviceCases?.destroy();
    rewardEntitlements?.destroy();
    posRecording?.destroy();
    serviceBriefing?.destroy();
    sessionEnded = true;
    sessionOnline = false;
    permissionSet = new Set();
    offlineGrant = null;
    staff = null;
    scanning = false;
    stopCamera();
    clearSelectedCustomer();
    applyUiPermissions();
  }

  async function completePendingLogout() {
    if (logoutFlight) return logoutFlight;
    const pendingMessage = "Sesión bloqueada en este dispositivo. El cierre en el servidor está pendiente de conexión; tus ventas siguen guardadas para su cuenta original.";
    if (!navigator.onLine) { toast(pendingMessage); return false; }
    logoutFlight = run(async () => {
      await api("/api/staff/logout", { method: "POST", body: "{}", signal: AbortSignal.timeout(10000) });
      logoutPending = false;
      try { localStorage.removeItem("pf_staff_logout_pending"); } catch {}
      redirectToLogin("Sesión cerrada. Las ventas pendientes siguen guardadas para su cuenta original.");
      return true;
    }, () => { toast(pendingMessage); return false; }).finally(() => { logoutFlight = null; });
    return logoutFlight;
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {(error: Error & {code?: string, status?: number, recoveryCaseId?: string}) => T | null | Promise<T | null>} [onError]
   * @returns {Promise<T | null>}
   */
  async function run(task, onError) {
    try {
      return await task();
    } catch (error) {
      if (onError) return onError(error);
      return null;
    }
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement}
   */
  function element(selector) {
    return /** @type {HTMLElement} */ ($(selector));
  }

  /**
   * @param {string} selector
   * @returns {HTMLInputElement}
   */
  function input(selector) {
    return /** @type {HTMLInputElement} */ ($(selector));
  }

  /**
   * @param {string} selector
   * @returns {HTMLSelectElement}
   */
  function select(selector) {
    return /** @type {HTMLSelectElement} */ ($(selector));
  }

  function setPendingStaffMfa(secret, otpauthUri = "") {
    const pendingStaffMfaSecret = String(secret || "").trim();
    const box = element("#staffMfaSecret");
    if (!pendingStaffMfaSecret) {
      box.textContent = "(sin secreto pendiente)";
      return;
    }
    box.textContent = `Secreto: ${pendingStaffMfaSecret}${otpauthUri ? `\n\nURI: ${otpauthUri}` : ""}`;
  }

  function redirectToLogin(message = "Necesitas iniciar sesión.") {
    toast(message);
    setTimeout(() => location.href = "/equipo/ingresar/", 600);
    return null;
  }

  async function refreshQueue() {
    const scope = currentScope();
    const q = await listStoredAwards(scope || {});
    const stats = await getAwardQueueStats(scope || undefined);
    element("#queueBadge").textContent = `Cola: ${stats.total}`;
    element("#queueMeta").textContent = `Pendientes: ${stats.queued} • Fallidos: ${stats.failed} • Última actividad: ${stats.lastQueuedAt ? new Date(stats.lastQueuedAt).toLocaleTimeString() : "—"}${stats.quarantined ? ` • ${stats.quarantined} operaciones antiguas sin identidad: requieren revisión; no se enviarán.` : ""}${hasOfflineGrant() ? " • Captura sin conexión disponible por 24 h desde la validación." : " • Conéctate para habilitar la captura sin conexión."}`;
    element("#queueList").textContent = q.length
      ? q.slice(-5).reverse().map((award) => {
        const base = `${new Date(award.updated_at || award.created_at || Date.now()).toLocaleTimeString()} • ${award.status || "queued"} • tx ${award.txId}`;
        return award.last_error ? `${base} • ${award.last_error}` : base;
      }).join("\n")
      : "(sin operaciones pendientes)";
  }

  async function ensureAuth() {
    if (hasPendingLogout()) { blockLocalSession(); await completePendingLogout(); return false; }
    if (sessionEnded) return false;
    if (authFlight) return authFlight;
    authFlight = run(async () => {
      const me = /** @type {StaffMeResponse} */ (await api("/api/staff/me"));
      if (sessionEnded) return false;
      if (!me.staff?.id || !me.staff?.business_id) throw new Error("La sesión no identifica el negocio. Vuelve a iniciar sesión.");
      if (staff && (staff.id !== me.staff.id || staff.business_id !== me.staff.business_id)) {
        permissionSet = null; programRule = null; offlineGrant = null;
        clearSelectedCustomer(); clearOfflineSnapshot();
      }
      staff = me.staff;
      planFeatures = me.features || {};
      await loadPermissions();
      await loadProgramRule();
      if (hasPerm("staff.award") && (!hasOfflineGrant() || Date.parse(offlineGrant.expiresAt) < Date.now() + 300000)) {
        try {
          const grant = await api("/api/staff/offline-grant");
          if (typeof grant?.grant === "string" && Date.parse(grant.expiresAt) > Date.now()) offlineGrant = { grant: grant.grant, expiresAt: grant.expiresAt };
        } catch (error) {
          if (isAuthError(error)) throw error;
        }
      }
      if (sessionEnded) return false;
      sessionOnline = true;
      writeOfflineSnapshot();
      applyUiPermissions();
      return true;
    }, async (error) => {
      sessionOnline = false;
      if (isAuthError(error)) {
        clearOfflineSnapshot();
        staff = null; permissionSet = new Set(); offlineGrant = null;
        clearSelectedCustomer();
        return redirectToLogin();
      }
      if (isNetworkFailure(error)) {
        const snapshot = readOfflineSnapshot();
        if (snapshot?.staff && (!staff || (staff.id === snapshot.staff.id && staff.business_id === snapshot.staff.business_id))) {
          staff = snapshot.staff;
          permissionSet = new Set(snapshot.permissions || []);
          planFeatures = snapshot.planFeatures || {};
          programRule = snapshot.programRule || null;
          offlineGrant = snapshot.offlineGrant || null;
          renderProgramInfo();
          updateInputsForRule();
          applyUiPermissions();
          toast("Modo sin conexión: usando la última sesión guardada.");
          return true;
        }
        return redirectToLogin("Sin conexión y sin sesión guardada.");
      }

      toast(error?.message || "No se pudo validar la sesión.");
      return null;
    }).finally(() => { authFlight = null; });
    return authFlight;
  }

  function hasPerm(p) {
    return !sessionEnded && permissionSet ? permissionSet.has(p) : false;
  }

  function hasFeature(feature) {
    return Object.prototype.hasOwnProperty.call(planFeatures, feature)
      ? Boolean(planFeatures[feature])
      : true;
  }

  function canUseRedeemFlow() {
    return navigator.onLine && sessionOnline && hasPerm("staff.redeem") && hasFeature("redemptions");
  }

  function canUseGiftCards() {
    return hasFeature("gift_cards") && Boolean(staff?.can_manage_gift_cards);
  }

  function applyUiPermissions() {
    const canAward = hasPerm("staff.award");
    const canRedeem = canUseRedeemFlow();
    const canSync = hasPerm("staff.sync");
    const canGiftCards = canUseGiftCards();

    /** @type {HTMLButtonElement} */ (element("#btnStart")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnAward")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnRedeem")).disabled = !canRedeem;
    /** @type {HTMLButtonElement} */ (element("#btnSync")).disabled = !canSync;
    /** @type {HTMLButtonElement} */ (element("#btnGiftRedeem")).disabled = !canGiftCards || !navigator.onLine || !sessionOnline;
    setHidden(element("#giftCardActionBlock"), !canGiftCards);

    // Analytics quick panel remains owner-only because endpoint is owner-only.
    setHidden(element("#ownerAnalyticsCard"), staff?.role !== "OWNER");
    updateCustomerSurfaceState();
  }

  async function loadPermissions() {
      const out = /** @type {StaffPermissionsResponse} */ (await api("/api/staff/permissions"));
      const matrix = out.matrix || {};
      const perms = Array.isArray(matrix[staff.role]) ? matrix[staff.role] : [];
      permissionSet = new Set(perms);
    applyUiPermissions();
  }

  function renderProgramInfo() {
    const el = element("#programInfo");
    if (!el || !programRule) return;
    const effective = protectedCycle ? { ...programRule, program_type: protectedCycle.program_type, program_json: protectedCycle.earning_terms } : programRule;
    const cfg = effective.program_json || {};
    if (effective.program_type === "SPEND") {
      el.textContent = `Regla ${protectedCycle ? "protegida" : "activa"}: Por gasto (${programRule.region?.currency || "GTQ"}). Tasa ${Number(cfg.points_per_q ?? 0.1)} pts/${programRule.region?.currency || "GTQ"} (${cfg.round || "ceil"}).`;
    } else if (effective.program_type === "VISIT") {
      el.textContent = `Regla ${protectedCycle ? "protegida" : "activa"}: Por visita (${Number(cfg.points_per_visit ?? 10)} pts por visita).`;
    } else {
      el.textContent = `Regla ${protectedCycle ? "protegida" : "activa"}: Por item (${Number(cfg.points_per_item ?? 1)} pts por item).`;
    }
  }

  function updateInputsForRule() {
    if (!programRule) return;
    const t = protectedCycle?.program_type || programRule.program_type;
    const currency = programRule.region?.currency || "GTQ";
    element("#staffAmountLabel").textContent = `Monto (${currency})`;
    element("#staffGiftAmountLabel").textContent = `Monto a descontar (${currency})`;
    input("#amount").step = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    input("#giftAmount").step = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    input("#giftAmount").min = programRule.region?.minorUnits === 0 ? "1" : "0.01";
    input("#amount").disabled = t !== "SPEND";
    input("#visits").disabled = t !== "VISIT";
    input("#items").disabled = t !== "ITEM";
    updateAwardPreview();
  }

  function getEligibleRewardCount() {
    return rewardOptions.reduce((count, reward) => {
      return count + (lastCustomerPoints >= Number(reward.points_cost || 0) ? 1 : 0);
    }, 0);
  }

  function updateCustomerSurfaceState(statusMessage = "") {
    const hasCustomer = Boolean(lastCustomerId || unverifiedSelection);
    const canRedeem = canUseRedeemFlow();
    const customerState = hasCustomer ? "ready" : "waiting";
    const readyChip = element("#customerReadyChip");
    const customerSummary = element("#staffCustomerSummary");
    const actionRail = element("#staffActionRail");
    const customerActionStatus = element("#customerActionStatus");
    const customerRewardState = element("#customerRewardState");
    const rewardHint = element("#rewardSelectionHint");
    const selectionStatus = element("#selectionStatus");
    const awardButton = /** @type {HTMLButtonElement} */ (element("#btnAward"));
    const redeemButton = /** @type {HTMLButtonElement} */ (element("#btnRedeem"));
    const rewardSelectEl = select("#rewardSelect");
    const eligibleRewardCount = getEligibleRewardCount();
    const hasRedeemableReward = canRedeem && hasCustomer && eligibleRewardCount > 0;

    if (readyChip) readyChip.textContent = hasCustomer ? "Cliente listo" : "Esperando cliente";
    if (customerSummary) customerSummary.dataset.customerState = customerState;
    if (actionRail) {
      actionRail.dataset.customerState = customerState;
      actionRail.classList.toggle("is-customer-ready", hasCustomer);
      actionRail.classList.toggle("is-customer-waiting", !hasCustomer);
    }

    if (selectionStatus) {
      selectionStatus.textContent = hasCustomer
        ? `Cliente seleccionado: ${lastCustomerId}. ${canRedeem
          ? (eligibleRewardCount > 0
            ? "Ahora puedes registrar o canjear."
            : "Ahora puedes registrar puntos; no hay recompensas canjeables ahora.")
          : "Ahora puedes registrar puntos."}`
        : selectionPromptCopy;
    }

    if (customerActionStatus) {
      customerActionStatus.textContent = statusMessage || (hasCustomer
        ? (canRedeem
          ? (eligibleRewardCount > 0
            ? "Cliente listo. Ahora puedes registrar puntos o canjear una recompensa."
            : "Cliente listo. Ahora puedes registrar puntos; no hay recompensas canjeables ahora.")
          : "Cliente listo. Ahora puedes registrar puntos.")
        : selectionPromptCopy);
    }

    if (customerRewardState) {
      if (!navigator.onLine || !sessionOnline) {
        customerRewardState.textContent = "Los canjes requieren conexión y sesión validada";
      } else if (!hasCustomer) {
        customerRewardState.textContent = "Aún no disponible";
      } else if (!hasFeature("redemptions")) {
        customerRewardState.textContent = "Canjes no disponibles en este plan";
      } else if (!hasPerm("staff.redeem")) {
        customerRewardState.textContent = "Canje no disponible para tu rol";
      } else if (!rewardOptions.length) {
        customerRewardState.textContent = "Sin recompensas activas";
      } else if (eligibleRewardCount === 1) {
        customerRewardState.textContent = "1 recompensa disponible";
      } else {
        customerRewardState.textContent = `${eligibleRewardCount} recompensas disponibles`;
      }
    }

    if (rewardHint) {
      rewardHint.textContent = hasCustomer
        ? (!canRedeem
          ? (!hasFeature("redemptions")
            ? "Los canjes no están disponibles en el plan actual."
            : "Tu rol no permite canjear recompensas.")
          : (rewardOptions.length
            ? "Las recompensas disponibles aparecen primero. Las que faltan puntos quedan deshabilitadas."
            : "No hay recompensas activas para este programa."))
        : selectionPromptCopy;
    }

    if (unverifiedSelection && customerActionStatus && !statusMessage) customerActionStatus.textContent = "Código capturado sin conexión. El cliente y sus puntos se verificarán en el servidor al sincronizar.";
    if (awardButton) awardButton.disabled = awardInFlight || storageFailed || !hasPerm("staff.award") || !hasCustomer || (!navigator.onLine && !hasOfflineGrant());
    if (redeemButton) redeemButton.disabled = !hasRedeemableReward;
    rewardSelectEl.disabled = !hasRedeemableReward;
    serviceCases?.contextChanged();
    rewardEntitlements?.contextChanged();
    posRecording?.contextChanged();
  }

  function updateAwardPreview() {
    const out = element("#awardPreview");
    if (!out || !programRule) return;
    if (!lastCustomerId) {
      out.textContent = selectionPromptCopy;
      return;
    }
    const effective = protectedCycle ? { ...programRule, program_type: protectedCycle.program_type, program_json: protectedCycle.earning_terms } : programRule;
    const cfg = effective.program_json || {};
    const amount = Number(input("#amount").value || 0);
    const visits = Math.floor(Number(input("#visits").value || 0));
    const items = Math.floor(Number(input("#items").value || 0));
    let preview = 0;

    if (effective.program_type === "VISIT") {
      preview = Math.max(0, (visits || 1) * Number(cfg.points_per_visit ?? 10));
    } else if (effective.program_type === "ITEM") {
      preview = Math.max(0, (items || 1) * Number(cfg.points_per_item ?? 1));
    } else {
      const rate = Number(cfg.points_per_q ?? 0.1);
      const raw = amount * rate;
      const round = String(cfg.round ?? "ceil");
      preview = round === "floor" ? Math.floor(raw) : round === "round" ? Math.round(raw) : Math.ceil(raw);
    }
    out.textContent = `Vista previa: se otorgarán aprox. ${Math.max(0, preview)} puntos con los valores actuales.`;
  }

  function renderRewardOptions() {
    const sel = select("#rewardSelect");
    const hint = element("#rewardSelectionHint");
    sel.replaceChildren();

    if (!rewardOptions.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No hay recompensas activas";
      sel.appendChild(opt);
      sel.disabled = true;
      if (hint) hint.textContent = "No hay recompensas activas para este programa.";
      return;
    }

    const sortedRewards = [...rewardOptions].sort((a, b) => {
      const aEligible = lastCustomerPoints >= Number(a.points_cost || 0);
      const bEligible = lastCustomerPoints >= Number(b.points_cost || 0);
      if (aEligible !== bEligible) return aEligible ? -1 : 1;
      return Number(a.points_cost || 0) - Number(b.points_cost || 0);
    });

    for (const reward of sortedRewards) {
      const pointsCost = Number(reward.points_cost || 0);
      const eligible = lastCustomerPoints >= pointsCost;
      const opt = document.createElement("option");
      opt.value = reward.id;
      opt.disabled = !eligible;
      opt.textContent = eligible
        ? `${reward.name} (${pointsCost} pts)`
        : `${reward.name} (${pointsCost} pts • faltan ${Math.max(0, pointsCost - lastCustomerPoints)})`;
      sel.appendChild(opt);
    }

    sel.disabled = !canUseRedeemFlow() || !lastCustomerId || !getEligibleRewardCount();
    if (hint && !lastCustomerId) {
      hint.textContent = selectionPromptCopy;
    }
    updateCustomerSurfaceState();
  }

  function applySelectedCustomer(customer, token, { silent = true } = {}) {
    unverifiedSelection = false;
    lastCustomerId = customer?.id || null;
    lastCustomerToken = token || "";
    lastCustomerPoints = Number(customer?.points || 0);
    element("#lastCustomer").textContent = customer?.id || "—";
    element("#lastCustomerName").textContent = customer?.name || "—";
    element("#lastCustomerPhone").textContent = customer?.phone || "—";
    element("#lastBalance").textContent = customer ? String(Number(customer.points || 0)) : "—";
    lastCustomerMovement = customer ? "Sin movimientos recientes" : "Sin movimientos recientes";
    element("#lastPoints").textContent = lastCustomerMovement;
    updateAwardPreview();
    renderRewardOptions();
    updateCustomerSurfaceState();
    if (!silent && lastCustomerId) {
      toast("Cliente seleccionado.");
    }
  }

  function clearSelectedCustomer() {
    applySelectedCustomer(null, "", { silent: true });
    element("#redeemCode").textContent = "—";
  }

  async function selectCustomerFromToken(token, { silent = true } = {}) {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      toast(selectionPromptCopy);
      return false;
    }

    if (!navigator.onLine || !sessionOnline) {
      if (!hasOfflineGrant()) { toast("Conéctate y valida tu sesión antes de capturar ventas sin conexión."); return false; }
      clearSelectedCustomer();
      lastCustomerToken = trimmed;
      unverifiedSelection = true;
      element("#lastCustomer").textContent = "Pendiente de verificación";
      updateCustomerSurfaceState();
      return true;
    }

    return run(async () => {
      const out = /** @type {StaffLookupCustomerResponse} */ (await api("/api/staff/customer/lookup", {
        method: "POST",
        body: JSON.stringify({ customerQrToken: trimmed })
      }));
      applySelectedCustomer(out.customer, trimmed, { silent });
      return true;
    }, (error) => {
      clearSelectedCustomer();
      updateCustomerSurfaceState();
      toast(error.message);
      return false;
    });
  }

  async function loadProgramRule() {
    const out = /** @type {StaffProgramRule} */ (await api("/api/staff/program"));
    programRule = out;
    renderProgramInfo();
    updateInputsForRule();
  }

  function canScan() {
    return "BarcodeDetector" in window && typeof BarcodeDetector === "function";
  }

  async function startCamera() {
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador no permite camara. Usa Chrome/Edge o pega el token manual.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    await video.play();

    if (canScan()) {
      try {
        const supported = typeof BarcodeDetector.getSupportedFormats === "function"
          ? await BarcodeDetector.getSupportedFormats()
          : null;
        if (Array.isArray(supported) && !supported.includes("qr_code")) {
          detector = null;
          toast("Tu navegador no soporta QR por camara. Usa entrada manual.");
          return;
        }
        detector = Array.isArray(supported)
          ? new BarcodeDetector({ formats: ["qr_code"] })
          : new BarcodeDetector();
      } catch {
        detector = null;
        toast("No se pudo activar escaneo QR. Usa entrada manual.");
      }
    } else {
      detector = null;
      toast("Este navegador no soporta BarcodeDetector. Usa entrada manual.");
    }
  }

  function stopCamera() {
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    const s = /** @type {MediaStream | null} */ (video.srcObject);
    if (s) s.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }

  async function award(token, scope) {
    const payload = {
      customerQrToken: token,
      amount_q: Number(input("#amount").value || 0),
      visits: Number(input("#visits").value || 1),
      items: Number(input("#items").value || 1),
      txId: uuidv4(),
      meta: { ui: "staff" },
      client_ts: new Date().toISOString(),
      ...(hasOfflineGrant() ? { offlineGrant: offlineGrant.grant } : {})
    };
    if (!Number.isFinite(payload.amount_q) || payload.amount_q < 0 || payload.amount_q > 1000000
      || Math.abs(payload.amount_q * 100 - Math.round(payload.amount_q * 100)) > 0.00001
      || !Number.isSafeInteger(payload.visits) || payload.visits < 1 || payload.visits > 1000
      || !Number.isSafeInteger(payload.items) || payload.items < 1 || payload.items > 10000) {
      const message = `Revisa el monto (0 a 1,000,000 ${programRule?.region?.currency || "GTQ"}) y las cantidades enteras de visitas y artículos.`;
      updateCustomerSurfaceState(message);
      toast(message);
      return false;
    }
    navigator.storage?.persist?.().catch(() => {});

    return run(async () => {
      const sent = await queue.submit(payload, scope);
      if (sent.queued) {
        updateCustomerSurfaceState("Guardado sin conexión. Pendiente de verificar y sumar puntos al sincronizar.");
        toast("Venta guardada en este dispositivo; los puntos aún no se han confirmado.");
        return true;
      }
      const out = /** @type {StaffAwardResponse} */ (sent.response);
      unverifiedSelection = false;
      element("#lastCustomer").textContent = out.customerId;
      const selectionStatus = element("#selectionStatus");
      if (selectionStatus) {
        selectionStatus.textContent = `Cliente seleccionado: ${out.customerId}. Ahora puedes registrar o canjear.`;
      }
      lastCustomerMovement = out.status === "PENDING"
        ? `Puntos pendientes: +${out.pointsAwarded}`
        : `Puntos: +${out.pointsAwarded}`;
      element("#lastPoints").textContent = lastCustomerMovement;
      element("#lastBalance").textContent = String(out.newBalance);
      lastCustomerId = out.customerId;
      lastCustomerToken = token;
      lastCustomerPoints = Number(out.newBalance || 0);
      renderRewardOptions();
      updateCustomerSurfaceState(out.status === "PENDING"
        ? `Puntos pendientes: +${out.pointsAwarded} (se liberan después).`
        : `Puntos registrados: +${out.pointsAwarded}. Nuevo saldo: ${out.newBalance}.`);
      if (out.status === "PENDING") {
        toast("Puntos pendientes: +" + out.pointsAwarded + " (se liberan después).");
      } else {
        toast("Listo: +" + out.pointsAwarded + " puntos");
      }
      return true;
    }, async (error) => {
      if (error.code === "OFFLINE_STORAGE_ERROR") {
        storageFailed = true;
        updateCustomerSurfaceState(error.message);
        toast(error.message);
        return false;
      }
      if (isNetworkFailure(error)) {
        updateCustomerSurfaceState("Guardado y pendiente de confirmación. Se reintentará automáticamente; no registres esta venta otra vez.");
        toast("Venta pendiente de confirmación. No la registres otra vez.");
        return true;
      }
      updateCustomerSurfaceState();
      toast(error.message);
      return false;
    });
  }

  async function scanLoop() {
    if (sessionEnded || !scanning || !detector) return;
    const video = /** @type {HTMLVideoElement} */ ($("#video"));
    await run(async () => {
      const codes = await detector.detect(video);
      if (codes && codes[0] && codes[0].rawValue) {
        const token = String(codes[0].rawValue || "").trim();
        const now = Date.now();
        // Ignora el mismo token por ~1 minuto para evitar reintentos del mismo QR.
        if (token && token === lastScannedToken && (now - lastScannedAt) < 65_000) {
          requestAnimationFrame(scanLoop);
          return;
        }

        scanning = false; // pause to avoid duplicates
        if (token) {
          lastScannedToken = token;
          lastScannedAt = now;
        }
        input("#token").value = token;
        await selectCustomerFromToken(token, { silent: false });
        setTimeout(() => { scanning = true; requestAnimationFrame(scanLoop); }, 1200);
        return;
      }
    });
    requestAnimationFrame(scanLoop);
  }

  element("#btnStart").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !hasPerm("staff.award")) return;
      await startCamera();
      scanning = true;
      requestAnimationFrame(scanLoop);
      toast("Selecciona un cliente...");
    }, (error) => {
      toast(error?.message || "No se pudo iniciar la camara.");
    });
  });

  element("#btnStop").addEventListener("click", () => {
    scanning = false;
    stopCamera();
    toast("Pausado.");
  });

  element("#btnAward").addEventListener("click", async () => {
    if (awardInFlight || storageFailed) return;
    if ((!lastCustomerId && !unverifiedSelection) || !lastCustomerToken) return toast("Primero selecciona un cliente.");
    awardInFlight = true;
    await run(async () => {
      updateCustomerSurfaceState("Registrando puntos...");
      await award(lastCustomerToken, currentScope());
    }).finally(() => {
      awardInFlight = false;
      const button = /** @type {HTMLButtonElement} */ (element("#btnAward"));
      button.disabled = storageFailed || !hasPerm("staff.award") || (!lastCustomerId && !unverifiedSelection) || (!navigator.onLine && !hasOfflineGrant());
    });
  });

  element("#btnSelectCustomer").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !hasPerm("staff.award")) return;
      const token = input("#token").value.trim();
      await selectCustomerFromToken(token, { silent: false });
    });
  });

  async function requestSync(manual = false) {
    if (sessionEnded) return;
    await run(async () => {
      const result = await queue.sync();
      await refreshQueue();
      if (manual) toast(result.attempted ? `Sincronizados: ${result.synced}/${result.attempted}` : navigator.onLine ? "Nada que sincronizar para esta cuenta." : "La sincronización requiere conexión.");
    }, (error) => {
      if (error.code === "OFFLINE_STORAGE_ERROR") storageFailed = true;
      if (manual || storageFailed) toast(error.message);
      updateCustomerSurfaceState(storageFailed ? error.message : "Las ventas siguen guardadas. Se reintentará la sincronización.");
    });
  }
  element("#btnSync").addEventListener("click", () => requestSync(true));

  element("#btnLogout").addEventListener("click", async () => {
    logoutPending = true;
    try {
      localStorage.setItem("pf_staff_logout_pending", "1");
      localStorage.setItem("pf_staff_epoch", uuidv4());
    } catch {}
    clearOfflineSnapshot();
    blockLocalSession();
    await completePendingLogout();
  });

  element("#btnStaffReauth").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline) return;
      const password = input("#staffReauthPassword").value;
      if (!password) return toast("Escribe tu contraseña actual.");
      await api("/api/staff/security/reauth", {
        method: "POST",
        body: JSON.stringify({
          password,
          ...(input("#staffReauthMfaCode").value.trim() ? { mfaCode: input("#staffReauthMfaCode").value.trim() } : {})
        })
      });
      toast("Sesión revalidada.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffMfaEnroll").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline) return;
      const out = await api("/api/staff/security/mfa/enroll", { method: "POST", body: "{}" });
      setPendingStaffMfa(out.secret, out.otpauth_uri || "");
      toast("Se generó un secreto MFA. Confirma con el código.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffMfaConfirm").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline) return;
      const code = input("#staffMfaConfirmCode").value.trim();
      if (!code) return toast("Escribe el código MFA.");
      await api("/api/staff/security/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code })
      });
      input("#staffMfaConfirmCode").value = "";
      setPendingStaffMfa("");
      toast("MFA activado.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffMfaDisable").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline) return;
      await api("/api/staff/security/mfa/disable", { method: "POST", body: "{}" });
      setPendingStaffMfa("");
      toast("MFA desactivado.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffLockdown").addEventListener("click", async () => {
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline) return;
      await api("/api/staff/security/lockdown", { method: "POST", body: "{}" });
      clearOfflineSnapshot();
      toast("Sesiones revocadas por seguridad.");
      setTimeout(() => location.href = "/equipo/ingresar/", 600);
    }, (error) => {
      toast(error.message);
    });
  });

  async function loadRewards() {
    await run(async () => {
      const out = /** @type {StaffRewardsResponse} */ (await api("/api/staff/rewards"));
      rewardOptions = out.rewards || [];
      renderRewardOptions();
      updateCustomerSurfaceState();
    });
  }

  element("#btnRedeem").addEventListener("click", async () => {
    if (!navigator.onLine || !sessionOnline) return toast("Los canjes requieren conexión. No se pueden guardar sin internet.");
    if (!lastCustomerId) return toast("Primero selecciona un cliente.");
    if (redeemInFlight) return;
    const customerAtRequest = lastCustomerId;
    const scopeAtRequest = JSON.stringify([currentScope(), staff?.branch_id ?? null]);
    const redemptionContextIsCurrent = () => !sessionEnded && lastCustomerId === customerAtRequest && scopeAtRequest === JSON.stringify([currentScope(), staff?.branch_id ?? null]);
    redeemInFlight = true;
    await run(async () => {
      if (!await ensureAuth() || !canUseRedeemFlow()) return;
      if (!redemptionContextIsCurrent()) return;
      const rewardId = select("#rewardSelect").value;
      if (!rewardId) return toast("Selecciona una recompensa disponible.");
      updateCustomerSurfaceState("Canjeando recompensa...");
      const out = /** @type {StaffRedeemResponse} */ (await api("/api/staff/redeem", {
        method: "POST",
        body: JSON.stringify({ customerId: lastCustomerId, rewardId, requestId: uuidv4() })
      }));
      if (!redemptionContextIsCurrent()) return;
      element("#redeemCode").textContent = out.redemptionCode;
      element("#lastBalance").textContent = String(out.newBalance);
      lastCustomerMovement = `Canje: ${out.redemptionCode}`;
      element("#lastPoints").textContent = lastCustomerMovement;
      lastCustomerPoints = Number(out.newBalance || 0);
      renderRewardOptions();
      updateCustomerSurfaceState(`Canje listo. Código: ${out.redemptionCode}. Nuevo saldo: ${out.newBalance}.`);
      toast("Canje listo. Código: " + out.redemptionCode);
      posRecording?.showRedemption({ ...out, customerId: customerAtRequest });
    }, (error) => {
      if (!redemptionContextIsCurrent()) return;
      updateCustomerSurfaceState();
      toast(error.message);
      if (error.recoveryCaseId) serviceCases?.showCase(error.recoveryCaseId);
    }).finally(() => {
      redeemInFlight = false;
    });
  });

  element("#btnSummary").addEventListener("click", async () => {
    await run(async () => {
      const out = await api("/api/admin/analytics/summary");
      element("#summary").textContent = JSON.stringify(out, null, 2);
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnGiftRedeem").addEventListener("click", async () => {
    if (!navigator.onLine || !sessionOnline) return toast("El uso de gift cards requiere conexión.");
    if (giftRedeemInFlight) return;
    giftRedeemInFlight = true;
    await run(async () => {
      if (!await ensureAuth() || !sessionOnline || !canUseGiftCards()) return;
      const code_or_token = input("#giftCode").value.trim();
      const amount_q = Number(input("#giftAmount").value || 0);
      if (!code_or_token) return toast("Escribe el código/token de gift card.");
      if (!(amount_q > 0)) return toast("Monto inválido.");
      const out = /** @type {StaffGiftRedeemResponse} */ (await api("/api/staff/gift-cards/redeem", {
        method: "POST",
        body: JSON.stringify({ code_or_token, amount_q, requestId: uuidv4() })
      }));
      const g = out.gift_card;
      element("#giftStatus").textContent = `OK. Saldo restante: ${new Intl.NumberFormat(programRule?.region?.locale, { style: "currency", currency: programRule?.region?.currency || "GTQ" }).format(Number(g.balance_q || 0))} (${g.status || "ACTIVE"})`;
      toast("Gift card canjeada.");
    }, (error) => {
      toast(error.message);
    }).finally(() => {
      giftRedeemInFlight = false;
    });
  });

  window.addEventListener("online", () => {
    if (hasPendingLogout()) { completePendingLogout(); return; }
    applyUiPermissions(); requestSync();
  });
  window.addEventListener("offline", () => { sessionOnline = false; applyUiPermissions(); refreshQueue().catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && navigator.onLine) { if (hasPendingLogout()) completePendingLogout(); else requestSync(); } });
  const syncTimer = setInterval(() => { if (!document.hidden && navigator.onLine) { if (hasPendingLogout()) completePendingLogout(); else requestSync(); } }, 30000);
  window.addEventListener("pagehide", () => { clearInterval(syncTimer); stopCamera(); });
  window.addEventListener("storage", (event) => {
    if (event.key === "pf_staff_logout_pending" && !event.newValue && sessionEnded) {
      redirectToLogin("La sesión se cerró o cambió en otra pestaña.");
      return;
    }
    let changed = event.key === null || event.key === "pf_staff_epoch" || (event.key === "pf_staff_logout_pending" && event.newValue === "1");
    if (event.key === "pf_staff_snapshot") {
      const snapshot = readOfflineSnapshot();
      changed ||= !snapshot || Boolean(staff && (snapshot.staff.id !== staff.id || snapshot.staff.business_id !== staff.business_id));
    }
    if (!changed) return;
    blockLocalSession();
    if (hasPendingLogout()) completePendingLogout();
    else redirectToLogin("La sesión cambió en otra pestaña. Vuelve a iniciar sesión.");
  });
  input("#amount").addEventListener("input", updateAwardPreview);
  input("#visits").addEventListener("input", updateAwardPreview);
  input("#items").addEventListener("input", updateAwardPreview);
  input("#token").addEventListener("input", () => {
    if (input("#token").value.trim() !== lastCustomerToken) {
      clearSelectedCustomer();
    }
  });

  if (!await ensureAuth()) return;
  try {
    await requeueSyncingAwards(currentScope());
    await refreshQueue();
  } catch {
    storageFailed = true;
    toast("El almacenamiento no está disponible. No registres ventas hasta recuperar la cola.");
  }
  clearSelectedCustomer();
  if (navigator.onLine) {
    await loadRewards();
    await requestSync();
  }

  posRecording = mountPosRecording({ container: element("#staffPosRecording"), api, getContext: () => ({ customerId: lastCustomerId, staffId: staff?.id, businessId: staff?.business_id, branchId: staff?.branch_id, online: canUseRedeemFlow() && !sessionEnded }) });
  rewardEntitlements = mountRewardEntitlements({ container: element("#staffRewardEntitlements"), api, getContext: () => ({ customerId: lastCustomerId, online: sessionOnline && !sessionEnded }), onCycle: cycle => { protectedCycle = cycle; renderProgramInfo(); updateInputsForRule(); }, onBalance: balance => { lastCustomerPoints = Number(balance); renderRewardOptions(); updateCustomerSurfaceState(); }, onRedeemed: result => posRecording?.showRedemption(result) });
  serviceCases = mountServiceCases({ container: element("#staffServiceCases"), api, getContext: () => ({ customerId: lastCustomerId, rewardId: select("#rewardSelect").value, online: sessionOnline && !sessionEnded }) });
  serviceBriefing = mountServiceBriefing({ container: element("#staffServiceBriefing"), api, program: programRule, rewards: rewardOptions });
  registerServiceWorker().catch(() => {});
}
