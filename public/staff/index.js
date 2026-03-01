/** @typedef {import("./types.js").StaffAwardResponse} StaffAwardResponse */
/** @typedef {import("./types.js").StaffGiftRedeemResponse} StaffGiftRedeemResponse */
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
  let detector = null;
  let lastScannedToken = "";
  let lastScannedAt = 0;
  /** @type {StaffProgramRule | null} */
  let programRule = null;
  /** @type {Set<string> | null} */
  let permissionSet = null;

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

  function redirectToLogin() {
    toast("Necesitas iniciar sesión.");
    setTimeout(() => location.href = "/staff/login", 600);
    throw new Error("no auth");
  }

  async function refreshQueue() {
    const q = await listAwards();
    element("#queueBadge").textContent = "Sin conexión: " + q.length;
  }

  async function ensureAuth() {
    await run(async () => {
      const me = /** @type {StaffMeResponse} */ (await api("/api/staff/me"));
      staff = me.staff;
      if (!permissionSet) await loadPermissions();
      if (!programRule) await loadProgramRule();
    }, redirectToLogin);
  }

  function hasPerm(p) {
    return permissionSet ? permissionSet.has(p) : false;
  }

  function applyUiPermissions() {
    if (!staff) return;
    const canAward = hasPerm("staff.award");
    const canRedeem = hasPerm("staff.redeem");
    const canSync = hasPerm("staff.sync");

    /** @type {HTMLButtonElement} */ (element("#btnStart")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnAward")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnRedeem")).disabled = !canRedeem;
    /** @type {HTMLButtonElement} */ (element("#btnSync")).disabled = !canSync;

    // Analytics quick panel remains owner-only because endpoint is owner-only.
    element("#ownerAnalyticsCard").style.display = staff.role === "OWNER" ? "block" : "none";
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

  function updateAwardPreview() {
    const out = element("#awardPreview");
    if (!out || !programRule) return;
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
      element("#lastPoints").textContent = String(out.pointsAwarded);
      element("#lastBalance").textContent = String(out.newBalance);
      lastCustomerId = out.customerId;
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
        toast("Sin internet: guardado para sincronizar.");
        return true;
      }
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
        await award(token);
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
      toast("Escaneando...");
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
      const token = input("#token").value.trim();
      if (!token) return toast("Pega un token o escanea.");
      await award(token);
    });
  });

  element("#btnSync").addEventListener("click", async () => {
    await run(async () => {
      await ensureAuth();
      const queued = await listAwards();
      if (!queued.length) return toast("Nada que sincronizar.");
      const out = /** @type {StaffSyncResponse} */ (await api("/api/staff/sync", { method: "POST", body: JSON.stringify({ awards: queued }) }));
      let ok = 0;
      for (const r of out.results) {
        if (r.ok) { ok++; await deleteAward(r.txId); }
      }
      await refreshQueue();
      toast("Sincronizados: " + ok + "/" + queued.length);
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnLogout").addEventListener("click", async () => {
    await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
    toast("Sesión cerrada.");
    setTimeout(() => location.href = "/staff/login", 600);
  });

  async function loadRewards() {
    await run(async () => {
      const out = /** @type {StaffRewardsResponse} */ (await api("/api/staff/rewards"));
      const sel = select("#rewardSelect");
      sel.replaceChildren();
      for (const r of out.rewards) {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.points_cost} pts)`;
        sel.appendChild(opt);
      }
    });
  }

  element("#btnRedeem").addEventListener("click", async () => {
    if (!lastCustomerId) return toast("Primero registra/escanea un cliente.");
    await run(async () => {
      const rewardId = select("#rewardSelect").value;
      const out = /** @type {StaffRedeemResponse} */ (await api("/api/staff/redeem", { method: "POST", body: JSON.stringify({ customerId: lastCustomerId, rewardId }) }));
      element("#redeemCode").textContent = out.redemptionCode;
      element("#lastBalance").textContent = String(out.newBalance);
      toast("Canje listo. Código: " + out.redemptionCode);
    }, (error) => {
      toast(error.message);
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
    await run(async () => {
      await ensureAuth();
      const code_or_token = input("#giftCode").value.trim();
      const amount_q = Number(input("#giftAmount").value || 0);
      if (!code_or_token) return toast("Escribe el código/token de gift card.");
      if (!(amount_q > 0)) return toast("Monto inválido.");
      const out = /** @type {StaffGiftRedeemResponse} */ (await api("/api/staff/gift-cards/redeem", {
        method: "POST",
        body: JSON.stringify({ code_or_token, amount_q })
      }));
      const g = out.gift_card;
      element("#giftStatus").textContent = `OK. Saldo restante: Q${Number(g.balance_q || 0).toFixed(2)} (${g.status || "ACTIVE"})`;
      toast("Gift card canjeada.");
    }, (error) => {
      toast(error.message);
    });
  });

  window.addEventListener("online", refreshQueue);
  input("#amount").addEventListener("input", updateAwardPreview);
  input("#visits").addEventListener("input", updateAwardPreview);
  input("#items").addEventListener("input", updateAwardPreview);

  await ensureAuth().catch(() => {});
  await refreshQueue();
  await loadRewards();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
