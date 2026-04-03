import { getAwardQueueStats, requeueSyncingAwards, updateAward, listAwards as listStoredAwards } from "/idb.js";
import { registerServiceWorker, setHidden } from "/lib.js";

/** @typedef {import("./types.js").StaffAwardResponse} StaffAwardResponse */
/** @typedef {import("./types.js").StaffGiftRedeemResponse} StaffGiftRedeemResponse */
/** @typedef {import("./types.js").StaffLookupCustomerResponse} StaffLookupCustomerResponse */
/** @typedef {import("./types.js").StaffMeResponse} StaffMeResponse */
/** @typedef {import("./types.js").StaffPermissionsResponse} StaffPermissionsResponse */
/** @typedef {import("./types.js").StaffProgramRule} StaffProgramRule */
/** @typedef {import("./types.js").StaffRedeemResponse} StaffRedeemResponse */
/** @typedef {import("./types.js").StaffRewardsResponse} StaffRewardsResponse */
/** @typedef {import("./types.js").StaffSyncResponse} StaffSyncResponse */

export async function initStaffPage({ api, $, toast, uuidv4, addAward, listAwards, deleteAward }) {
  /** @type {import("./types.js").StaffProfile | null} */
  let staff = null;
  let scanning = false;
  let lastCustomerId = null;
  let lastCustomerToken = "";
  let lastCustomerPoints = 0;
  let detector = null;
  let lastScannedToken = "";
  let lastScannedAt = 0;
  let redeemInFlight = false;
  let giftRedeemInFlight = false;
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

  function isAuthError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    return code === "AUTH_REQUIRED"
      || code === "AUTH_INVALID_TOKEN"
      || code === "FORBIDDEN"
      || /No autenticado|Token invalido|No autorizado|no auth/i.test(message);
  }

  function isNetworkFailure(error) {
    const message = String(error?.message || "");
    return !navigator.onLine || /NetworkError|Failed to fetch|fetch|abort/i.test(message);
  }

  function readOfflineSnapshot() {
    try {
      const raw = localStorage.getItem("pf_staff_snapshot");
      return raw ? JSON.parse(raw) : null;
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
        updatedAt: new Date().toISOString()
      }));
    } catch {}
  }

  function clearOfflineSnapshot() {
    try {
      localStorage.removeItem("pf_staff_snapshot");
    } catch {}
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {(error: Error) => T | null | Promise<T | null>} [onError]
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
    setTimeout(() => location.href = "/staff/login", 600);
    return null;
  }

  async function refreshQueue() {
    const q = await listAwards();
    const stats = await getAwardQueueStats();
    element("#queueBadge").textContent = `Cola: ${stats.total}`;
    element("#queueMeta").textContent = `Pendientes: ${stats.queued} • Fallidos: ${stats.failed} • Última actividad: ${stats.lastQueuedAt ? new Date(stats.lastQueuedAt).toLocaleTimeString() : "—"}`;
    element("#queueList").textContent = q.length
      ? q.slice(-5).reverse().map((award) => {
        const base = `${new Date(award.updated_at || award.created_at || Date.now()).toLocaleTimeString()} • ${award.status || "queued"} • tx ${award.txId}`;
        return award.last_error ? `${base} • ${award.last_error}` : base;
      }).join("\n")
      : "(sin operaciones pendientes)";
  }

  async function ensureAuth() {
    return run(async () => {
      const me = /** @type {StaffMeResponse} */ (await api("/api/staff/me"));
      staff = me.staff;
      planFeatures = me.features || {};
      if (!permissionSet) await loadPermissions();
      if (!programRule) await loadProgramRule();
      writeOfflineSnapshot();
      return true;
    }, async (error) => {
      if (isNetworkFailure(error)) {
        const snapshot = readOfflineSnapshot();
        if (snapshot?.staff) {
          staff = snapshot.staff;
          permissionSet = new Set(snapshot.permissions || []);
          planFeatures = snapshot.planFeatures || {};
          programRule = snapshot.programRule || null;
          renderProgramInfo();
          updateInputsForRule();
          applyUiPermissions();
          toast("Modo sin conexión: usando la última sesión guardada.");
          return true;
        }
        return redirectToLogin("Sin conexión y sin sesión guardada.");
      }

      if (isAuthError(error)) {
        clearOfflineSnapshot();
        return redirectToLogin();
      }

      toast(error?.message || "No se pudo validar la sesión.");
      return null;
    });
  }

  function hasPerm(p) {
    return permissionSet ? permissionSet.has(p) : false;
  }

  function hasFeature(feature) {
    return Object.prototype.hasOwnProperty.call(planFeatures, feature)
      ? Boolean(planFeatures[feature])
      : true;
  }

  function canUseRedeemFlow() {
    return hasPerm("staff.redeem") && hasFeature("redemptions");
  }

  function canUseGiftCards() {
    return hasFeature("gift_cards") && Boolean(staff?.can_manage_gift_cards);
  }

  function applyUiPermissions() {
    if (!staff) return;
    const canAward = hasPerm("staff.award");
    const canRedeem = canUseRedeemFlow();
    const canSync = hasPerm("staff.sync");
    const canGiftCards = canUseGiftCards();

    /** @type {HTMLButtonElement} */ (element("#btnStart")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnAward")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnRedeem")).disabled = !canRedeem;
    /** @type {HTMLButtonElement} */ (element("#btnSync")).disabled = !canSync;
    /** @type {HTMLButtonElement} */ (element("#btnGiftRedeem")).disabled = !canGiftCards;
    setHidden(element("#giftCardActionBlock"), !canGiftCards);

    // Analytics quick panel remains owner-only because endpoint is owner-only.
    setHidden(element("#ownerAnalyticsCard"), staff.role !== "OWNER");
    updateCustomerSurfaceState();
  }

  async function loadPermissions() {
    await run(async () => {
      const out = /** @type {StaffPermissionsResponse} */ (await api("/api/staff/permissions"));
      const matrix = out.matrix || {};
      const perms = Array.isArray(matrix[staff.role]) ? matrix[staff.role] : [];
      permissionSet = new Set(perms);
    }, () => {
      permissionSet = new Set();
    });
    applyUiPermissions();
  }

  function renderProgramInfo() {
    const el = element("#programInfo");
    if (!el || !programRule) return;
    const cfg = programRule.program_json || {};
    if (programRule.program_type === "SPEND") {
      el.textContent = `Regla activa: Por gasto (Q). Tasa ${Number(cfg.points_per_q ?? 0.1)} pts/Q (${cfg.round || "ceil"}).`;
    } else if (programRule.program_type === "VISIT") {
      el.textContent = `Regla activa: Por visita (${Number(cfg.points_per_visit ?? 10)} pts por visita).`;
    } else {
      el.textContent = `Regla activa: Por item (${Number(cfg.points_per_item ?? 1)} pts por item).`;
    }
  }

  function updateInputsForRule() {
    if (!programRule) return;
    const t = programRule.program_type;
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
    const hasCustomer = Boolean(lastCustomerId);
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
      if (!hasCustomer) {
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

    if (awardButton) awardButton.disabled = !hasPerm("staff.award") || !hasCustomer;
    if (redeemButton) redeemButton.disabled = !hasRedeemableReward;
    rewardSelectEl.disabled = !hasRedeemableReward;
  }

  function updateAwardPreview() {
    const out = element("#awardPreview");
    if (!out || !programRule) return;
    if (!lastCustomerId) {
      out.textContent = selectionPromptCopy;
      return;
    }
    const cfg = programRule.program_json || {};
    const amount = Number(input("#amount").value || 0);
    const visits = Math.floor(Number(input("#visits").value || 0));
    const items = Math.floor(Number(input("#items").value || 0));
    let preview = 0;

    if (programRule.program_type === "VISIT") {
      preview = Math.max(0, (visits || 1) * Number(cfg.points_per_visit ?? 10));
    } else if (programRule.program_type === "ITEM") {
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

  async function award(token) {
    const payload = {
      customerQrToken: token,
      amount_q: Number(input("#amount").value || 0),
      visits: Number(input("#visits").value || 1),
      items: Number(input("#items").value || 1),
      txId: uuidv4(),
      meta: { ui: "staff" }
    };

    return run(async () => {
      const out = /** @type {StaffAwardResponse} */ (await api("/api/staff/award", { method: "POST", body: JSON.stringify(payload) }));
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
      if (!navigator.onLine || /NetworkError|Failed to fetch|fetch/i.test(error.message)) {
        await addAward({ ...payload, client_ts: new Date().toISOString() });
        await refreshQueue();
        updateCustomerSurfaceState("Sin internet: guardado para sincronizar.");
        toast("Sin internet: guardado para sincronizar.");
        return true;
      }
      updateCustomerSurfaceState();
      toast(error.message);
      return false;
    });
  }

  async function scanLoop() {
    if (!scanning || !detector) return;
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
      await ensureAuth();
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
    await run(async () => {
      await ensureAuth();
      if (!lastCustomerId || !lastCustomerToken) return toast("Primero selecciona un cliente.");
      updateCustomerSurfaceState("Registrando puntos...");
      await award(lastCustomerToken);
    });
  });

  element("#btnSelectCustomer").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
      const token = input("#token").value.trim();
      await selectCustomerFromToken(token, { silent: false });
    });
  });

  element("#btnSync").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
      const queued = await listStoredAwards({ statuses: ["queued", "failed", "syncing"] });
      if (!queued.length) return toast("Nada que sincronizar.");
      await Promise.all(queued.map((award) => updateAward(award.txId, { status: "syncing", last_error: "" })));
      await refreshQueue();
      const out = /** @type {StaffSyncResponse} */ (await api("/api/staff/sync", { method: "POST", body: JSON.stringify({ awards: queued }) }));
      let ok = 0;
      for (const r of out.results) {
        if (r.ok) {
          ok++;
          await deleteAward(r.txId);
        } else {
          const current = queued.find((award) => award.txId === r.txId);
          await updateAward(r.txId, {
            status: "failed",
            last_error: String(r.error || "Error de sincronización"),
            retry_count: Number(current?.retry_count || 0) + 1
          });
        }
      }
      await refreshQueue();
      toast("Sincronizados: " + ok + "/" + queued.length);
    }, (error) => {
      listStoredAwards({ statuses: ["syncing"] })
        .then((syncing) => Promise.all(syncing.map((award) => updateAward(award.txId, {
          status: "failed",
          last_error: error.message,
          retry_count: Number(award.retry_count || 0) + 1
        }))))
        .then(refreshQueue)
        .catch(() => {});
      toast(error.message);
    });
  });

  element("#btnLogout").addEventListener("click", async () => {
    await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
    clearOfflineSnapshot();
    toast("Sesión cerrada.");
    setTimeout(() => location.href = "/staff/login", 600);
  });

  element("#btnStaffReauth").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
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
      await ensureAuth();
      const out = await api("/api/staff/security/mfa/enroll", { method: "POST", body: "{}" });
      setPendingStaffMfa(out.secret, out.otpauth_uri || "");
      toast("Se generó un secreto MFA. Confirma con el código.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffMfaConfirm").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
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
      await ensureAuth();
      await api("/api/staff/security/mfa/disable", { method: "POST", body: "{}" });
      setPendingStaffMfa("");
      toast("MFA desactivado.");
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnStaffLockdown").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
      await api("/api/staff/security/lockdown", { method: "POST", body: "{}" });
      clearOfflineSnapshot();
      toast("Sesiones revocadas por seguridad.");
      setTimeout(() => location.href = "/staff/login", 600);
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
    if (!lastCustomerId) return toast("Primero selecciona un cliente.");
    if (redeemInFlight) return;
    redeemInFlight = true;
    await run(async () => {
      const rewardId = select("#rewardSelect").value;
      if (!rewardId) return toast("Selecciona una recompensa disponible.");
      updateCustomerSurfaceState("Canjeando recompensa...");
      const out = /** @type {StaffRedeemResponse} */ (await api("/api/staff/redeem", {
        method: "POST",
        body: JSON.stringify({ customerId: lastCustomerId, rewardId, requestId: uuidv4() })
      }));
      element("#redeemCode").textContent = out.redemptionCode;
      element("#lastBalance").textContent = String(out.newBalance);
      lastCustomerMovement = `Canje: ${out.redemptionCode}`;
      element("#lastPoints").textContent = lastCustomerMovement;
      lastCustomerPoints = Number(out.newBalance || 0);
      renderRewardOptions();
      updateCustomerSurfaceState(`Canje listo. Código: ${out.redemptionCode}. Nuevo saldo: ${out.newBalance}.`);
      toast("Canje listo. Código: " + out.redemptionCode);
    }, (error) => {
      updateCustomerSurfaceState();
      toast(error.message);
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
    if (giftRedeemInFlight) return;
    giftRedeemInFlight = true;
    await run(async () => {
      await ensureAuth();
      const code_or_token = input("#giftCode").value.trim();
      const amount_q = Number(input("#giftAmount").value || 0);
      if (!code_or_token) return toast("Escribe el código/token de gift card.");
      if (!(amount_q > 0)) return toast("Monto inválido.");
      const out = /** @type {StaffGiftRedeemResponse} */ (await api("/api/staff/gift-cards/redeem", {
        method: "POST",
        body: JSON.stringify({ code_or_token, amount_q, requestId: uuidv4() })
      }));
      const g = out.gift_card;
      element("#giftStatus").textContent = `OK. Saldo restante: Q${Number(g.balance_q || 0).toFixed(2)} (${g.status || "ACTIVE"})`;
      toast("Gift card canjeada.");
    }, (error) => {
      toast(error.message);
    }).finally(() => {
      giftRedeemInFlight = false;
    });
  });

  window.addEventListener("online", refreshQueue);
  input("#amount").addEventListener("input", updateAwardPreview);
  input("#visits").addEventListener("input", updateAwardPreview);
  input("#items").addEventListener("input", updateAwardPreview);
  input("#token").addEventListener("input", () => {
    if (input("#token").value.trim() !== lastCustomerToken) {
      clearSelectedCustomer();
    }
  });

  await requeueSyncingAwards().catch(() => {});
  await ensureAuth();
  await refreshQueue();
  clearSelectedCustomer();
  if (navigator.onLine) {
    await loadRewards();
  }

  registerServiceWorker().catch(() => {});
}
