import { api, $, toast, setHidden, hydrateShellLinks } from "/lib.js";
import { enrollmentAcquisition } from "./acquisition-entry.js";
import { applyJoinBranding } from "./customer-branding.js";
import { clearCustomerCache } from "/idb.js";
import { getCustomerEpoch, invalidateCustomerIdentity, isCustomerAuthError } from "./customer/session.js";
import { renderNativeWallet } from "./customer/native-wallet.js";

const returningSlugKey = "pf_customer_joined_slug";

function normalizedPhone(value,country="GT") {
  const digits = String(value || "").replace(/\D/g, "");
  return country === "GT" && digits.length === 8 ? `502${digits}` : digits;
}

function setFeedback(selector, message) {
  const el = $(selector);
  if (!el) return;
  el.textContent = String(message || "").trim();
}

function setStep(step) {
  const ids = ["joinStepRequest", "joinStepVerify", "joinStepDone"];
  ids.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("active", idx + 1 <= step);
  });
}

function startCooldown($, seconds = 60) {
  const endsAt = Date.now() + seconds * 1000;
  let cooldownTimer = null;
  const codeButton = $("#btnCode");
  const resendButton = $("#btnResendCode");
  const cooldownInfo = $("#codeCooldownInfo");
  if (!codeButton) return () => {};

  codeButton.disabled = true;
  if (resendButton) resendButton.disabled = true;
  const tick = () => {
    const cooldownLeft = Math.ceil((endsAt - Date.now()) / 1000);
    if (cooldownLeft <= 0) {
      codeButton.disabled = false;
      if (resendButton) resendButton.disabled = false;
      if (cooldownInfo) cooldownInfo.textContent = "";
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      return;
    }
    if (cooldownInfo) cooldownInfo.textContent = `Puedes reenviar en ${cooldownLeft}s`;
  };

  cooldownTimer = setInterval(tick, 1000);
  tick();
  return () => {
    clearInterval(cooldownTimer);
  };
}

function setModeCopy(mode, businessName, entryReason) {
  const title = $("#title");
  const subtitle = $("#subtitle");
  const doneTitle = $("#doneTitle");
  const doneSubtitle = $("#doneSubtitle");
  const poweredBy = $("#customerPoweredBy");
  const entryContext = $("#joinEntryContext");
  const verifyButton = $("#btnVerify");
  const switchLink = $("#entryModeLink");
  const switchText = $("#entryModeLinkText");
  const isLogin = mode === "login";
  const slug = encodeURIComponent(String(location.pathname.split("/").filter(Boolean).pop() || ""));
  const safeBusinessName = businessName || "este negocio";

  if (title) {
    title.textContent = isLogin ? "Ingresa a tu tarjeta" : "Activa tu tarjeta";
  }
  if (subtitle) {
    subtitle.textContent = isLogin
      ? `Recibe un código para volver a abrir tu tarjeta de ${safeBusinessName} en este navegador.`
      : `Confirma tu teléfono para activar tu tarjeta de ${safeBusinessName}.`;
  }
  if (doneTitle) {
    doneTitle.textContent = isLogin ? "Tarjeta reactivada." : "Tu tarjeta ya está activa.";
  }
  if (doneSubtitle) {
    doneSubtitle.textContent = `Tu cuenta de ${safeBusinessName} está lista. Elige cómo llevar tu tarjeta.`;
  }
  if (verifyButton) {
    verifyButton.textContent = isLogin ? "Verificar y entrar" : "Verificar y crear tarjeta";
  }
  if (switchLink && switchText) {
    switchLink.hidden = false;
    switchLink.href = isLogin
      ? `/registro/${slug}`
      : `/ingresar/${slug}`;
    switchText.textContent = isLogin
      ? "Todavía no tengo tarjeta"
      : "Ya tengo tarjeta";
  }
  if (entryContext) {
    if (isLogin) {
      if (entryReason === "session-expired" || entryReason === "sesion-vencida") {
        entryContext.textContent = `Tu sesión anterior de ${safeBusinessName} ya venció. Solicita un nuevo código para volver a abrir tu tarjeta.`;
      } else if (entryReason === "logged-out" || entryReason === "salida") {
        entryContext.textContent = `Cerraste tu sesión de ${safeBusinessName}. Solicita un nuevo código si quieres volver a entrar desde este navegador.`;
      } else {
        entryContext.textContent = "Recibe un código y vuelve a abrir tu tarjeta desde este navegador.";
      }
      entryContext.classList.remove("is-hidden");
      setFeedback("#joinRequestFeedback", "Solicita un nuevo código para ingresar.");
      setFeedback("#joinVerifyFeedback", "Cuando recibas el código, verifícalo para abrir tu tarjeta.");
    } else {
      entryContext.textContent = "";
      setHidden(entryContext, true);
      setFeedback("#joinRequestFeedback", "");
      setFeedback("#joinVerifyFeedback", "");
    }
  }
  if (poweredBy) {
    poweredBy.textContent = "Powered by PuntosFieles";
  }

  document.title = isLogin ? "Ingresar • PuntosFieles" : "Registro • PuntosFieles";
}

/**
 * @param {{ mode: "register" | "login" }} params
 */
export async function initCustomerAuthEntry({ mode }) {
  hydrateShellLinks();

  const slug = location.pathname.split("/").filter(Boolean).pop();
  if (!slug) {
    toast("Falta slug");
    return;
  }

  const searchParams = new URLSearchParams(location.search);
  const entryReason = (searchParams.get("motivo") || "").trim();
  const requestPath = mode === "login"
    ? `/api/public/business/${slug}/login/request-code`
    : `/api/public/business/${slug}/join/request-code`;
  const verifyPath = mode === "login"
    ? `/api/public/business/${slug}/login/verify`
    : `/api/public/business/${slug}/join/verify`;
  if (mode === "register" && ["session-expired", "logged-out", "sesion-vencida", "salida"].includes(entryReason)) {
    location.replace(`/ingresar/${encodeURIComponent(slug)}${entryReason ? `?motivo=${encodeURIComponent(entryReason)}` : ""}`);
    return;
  }

  let cooldownReset = () => {};
  let requesting = false;
  let verifying = false;
  let completed = false;
  let refreshing = false;
  let active = true;
  let walletEpoch = getCustomerEpoch();
  let customerId = "";
  let business;
  let interacted = false;
  let sentPhone = "";
  let cooldownEndsAt = 0;

  try {
    business = await api("/api/public/business/" + slug);
    const branding = applyJoinBranding($, business);
    if (business.region?.country && business.region.country !== "GT") {
      $("#phone").placeholder = "+ código de país y número";
      if ($("#phoneHelp")) $("#phoneHelp").textContent = "Incluye + y el código internacional. Te enviaremos un código por los canales disponibles.";
    }
    setModeCopy(mode, branding.businessName, entryReason);
  } catch {
    setFeedback("#joinRequestFeedback", "No pudimos cargar este negocio. Revisa el enlace o vuelve a cargar la página.");
    toast("No pudimos cargar el negocio");
    return;
  }

  const acquisition = enrollmentAcquisition({ mode, slug, search: location.search, api });

  setStep(1);
  setHidden($("#joinForms"), false);
  setHidden($("#joinRequestForm"), false);
  $("#btnCode").disabled = false;
  const current = () => active && walletEpoch === getCustomerEpoch();
  function resetPhone() {
    cooldownReset();
    cooldownEndsAt = 0;
    sentPhone = "";
    $("#btnCode").disabled = false;
    $("#btnCode").textContent = "Enviar código";
    $("#phone").readOnly = false;
    $("#code").value = "";
    for (const selector of ["#codeInfo", "#codeCooldownInfo", "#joinRequestFeedback", "#joinVerifyFeedback"]) setFeedback(selector, "");
    setHidden($("#joinVerifyStage"), true);
    setHidden($("#joinRequestForm"), false);
    setStep(1);
  }
  function resetCompletion() {
    completed = false;
    customerId = "";
    setHidden($("#done"), true);
    setHidden($("#billeteras"), true);
    setHidden($("#joinForms"), false);
    document.body?.classList.toggle("wallet-enrollment-done", false);
    setModeCopy(mode, business.name, entryReason);
    resetPhone();
    setFeedback("#joinRequestFeedback", "Tu sesión cambió. Verifica tu teléfono para continuar con esta tarjeta.");
  }

  function showCompletion() {
    const firstCompletion = !completed;
    completed = true;
    cooldownReset();
    setHidden($("#joinForms"), true);
    setHidden($("#done"), false);
    setHidden($("#btnRetryWallet"), true);
    document.body?.classList.toggle("wallet-enrollment-done", true);
    setFeedback("#title", "Tu tarjeta, contigo.");
    setFeedback("#subtitle", `Lleva tu tarjeta de ${business.name} en Wallet o en tu navegador.`);
    setStep(3);
    if (firstCompletion) $("#doneTitle")?.focus();
  }

  async function showWallet(me) {
    if (!current() || me?.business?.id !== business.id || !me?.customer?.id
        || (customerId && customerId !== me.customer.id)) return false;
    customerId = me.customer.id;
    showCompletion();
    setFeedback("#walletEnrollmentFeedback", "Buscando opciones para guardar tu tarjeta…");
    try {
      await renderNativeWallet({ api, $, identity: { businessId: business.id, customerId }, isCurrent: current }, true);
      if (!current()) return false;
      const unavailable = $("#billeteras").hidden;
      setFeedback("#walletEnrollmentFeedback", unavailable
        ? "Puedes abrir tu tarjeta y consultar tus puntos en el navegador. Si esperabas guardarla en Wallet, vuelve a intentar." : "");
      setHidden($("#btnRetryWallet"), !unavailable);
    } catch (error) {
      if (current() && isCustomerAuthError(error)) resetCompletion();
    }
    return true;
  }

  async function refreshWallet() {
    if (!completed || !current() || refreshing) return;
    refreshing = true;
    $("#btnRetryWallet").disabled = true;
    try {
      const me = await api("/api/customer/me");
      if (!current()) return;
      if (!await showWallet(me)) resetCompletion();
    } catch (error) {
      if (!current()) return;
      if (isCustomerAuthError(error)) resetCompletion();
      else {
        setFeedback("#walletEnrollmentFeedback", "No pudimos conectar. Revisa tu conexión y vuelve a intentar; tu cuenta sigue creada.");
        setHidden($("#btnRetryWallet"), false);
      }
    } finally {
      refreshing = false;
      $("#btnRetryWallet").disabled = false;
    }
  }
  $("#btnRetryWallet")?.addEventListener("click", refreshWallet);
  $("#phone").addEventListener("input", () => { interacted = true; });
  // Phone ownership cannot be established through an unverified email address.
  const emailField = $("#email");
  if (emailField) {
    emailField.hidden = true;
    emailField.disabled = true;
    if (emailField.previousElementSibling?.tagName === "LABEL") emailField.previousElementSibling.hidden = true;
  }

  const requestCode = async (event) => {
    event?.preventDefault();
    if (requesting || verifying || completed || $("#btnCode").disabled) return;
    interacted = true;
    requesting = true;
    let sent = false;
    $("#btnCode").disabled = true;
    $("#btnResendCode").disabled = true;
    try {
      const phone = $("#phone").value.trim();
      if (!phone) {
        setFeedback("#joinRequestFeedback", "Escribe el teléfono para recibir el código.");
        return toast("Escribe el teléfono");
      }
      setFeedback("#joinRequestFeedback", "Enviando código...");
      $("#phone").readOnly = true;
      const name = $("#name")?.value.trim() || undefined;
      await api(requestPath, {
        method: "POST",
        body: JSON.stringify({ phone, name })
      });
      sent = true;
      sentPhone = phone;
      $("#codeInfo").textContent = "Código enviado a tu teléfono por WhatsApp o SMS.";
      setFeedback("#verificationPhone", phone);
      setFeedback("#joinRequestFeedback", "Código enviado. Escríbelo abajo para continuar.");
      setStep(2);
      setHidden($("#joinVerifyStage"), false);
      setHidden($("#joinRequestForm"), true);
      $("#phone").readOnly = true;
      $("#btnCode").textContent = "Reenviar código";
      cooldownReset();
      cooldownEndsAt = Date.now() + 60000;
      cooldownReset = startCooldown($, 60);
      $("#code").focus();
      toast("Código enviado.");
    } catch (e) {
      const message = e?.message || "No se pudo enviar el código.";
      setFeedback("#joinRequestFeedback", message);
      toast(message);
    } finally {
      requesting = false;
      if (!sent) {
        if (!sentPhone) $("#phone").readOnly = false;
        $("#btnCode").disabled = false;
        $("#btnResendCode").disabled = false;
      }
    }
  };
  $("#btnCode").addEventListener("click", requestCode);
  $("#btnResendCode")?.addEventListener("click", requestCode);
  $("#joinRequestForm")?.addEventListener("submit", requestCode);

  const verifyCode = async (event) => {
    event?.preventDefault();
    if (verifying || requesting || completed) return;
    interacted = true;
    verifying = true;
    let verificationEpoch = getCustomerEpoch();
    $("#btnVerify").disabled = true;
    const phone = sentPhone || $("#phone").value.trim();
    try {
      const code = $("#code").value.trim();
      const name = $("#name")?.value.trim() || undefined;
      if (!phone || !code) {
        setFeedback("#joinVerifyFeedback", "Escribe el teléfono y el código recibido.");
        return toast("Falta teléfono o código");
      }
      setFeedback("#joinVerifyFeedback", "Verificando código...");
      const verified = await api(verifyPath, {
        method: "POST",
        body: JSON.stringify({ phone, code, name, ...await acquisition })
      });
      if (!active || verificationEpoch !== getCustomerEpoch()) return;
      if (verified?.ok !== true || !verified?.customer?.id) throw new Error("No pudimos confirmar tu acceso. Vuelve a intentar.");
      invalidateCustomerIdentity();
      walletEpoch = getCustomerEpoch();
      verificationEpoch = walletEpoch;
      customerId = verified.customer.id;
      await clearCustomerCache().catch(() => {});
      if (!current()) return;
      try {
        localStorage.setItem(returningSlugKey, slug);
        localStorage.setItem("pf_customer_slug", slug);
      } catch { /* Login remains available when storage is restricted. */ }
      showCompletion();
      setFeedback("#walletEnrollmentFeedback", "Preparando las opciones de tu tarjeta…");
      // The session cookie, not the submitted phone or a Wallet identity, authorizes issuance.
      const me = await api("/api/customer/me");
      if (!current()) return;
      if (!await showWallet(me)) { resetCompletion(); return; }
      toast("Tu tarjeta está lista.");
    } catch (e) {
      if (!active || verificationEpoch !== getCustomerEpoch()) return;
      if (completed) {
        if (isCustomerAuthError(e)) resetCompletion();
        else {
          setFeedback("#walletEnrollmentFeedback", "Tu acceso está verificado. No pudimos cargar Wallet; revisa tu conexión y vuelve a intentar.");
          setHidden($("#btnRetryWallet"), false);
        }
        return;
      }
      // A dropped response may still have set the session cookie. Recover only
      // the intended business AND verified phone, never an unrelated session.
      if (!e?.status && active) {
        try {
          const me = await api("/api/customer/me");
          if (!active || verificationEpoch !== getCustomerEpoch()) return;
          if (me?.business?.id === business.id && me?.customer?.id && normalizedPhone(phone,business.region?.country||"GT")
              && normalizedPhone(me.customer.phone,business.region?.country||"GT") === normalizedPhone(phone,business.region?.country||"GT")) {
            invalidateCustomerIdentity();
            walletEpoch = getCustomerEpoch();
            customerId = me.customer.id;
            await clearCustomerCache().catch(() => {});
            if (current()) await showWallet(me);
            return;
          }
        } catch { /* Keep the code form available for a fresh verification attempt. */ }
      }
      const message = e?.message || "No se pudo verificar el código.";
      setFeedback("#joinVerifyFeedback", message);
      toast(message);
    } finally {
      verifying = false;
      $("#btnVerify").disabled = false;
    }
  };
  $("#btnVerify").addEventListener("click", verifyCode);
  $("#joinVerifyForm")?.addEventListener("submit", verifyCode);

  $("#btnChangePhone")?.addEventListener("click", () => {
    if (requesting || verifying || completed) return;
    resetPhone();
    $("#phone").focus();
  });

  window.addEventListener("storage", (event) => {
    if ((event.key === "pf_customer_epoch" || event.key === null) && !current()) resetCompletion();
  });
  window.addEventListener("online", refreshWallet);
  window.addEventListener("pagehide", () => { active = false; cooldownReset(); });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    active = true;
    if (!current()) resetCompletion();
    else if (completed) refreshWallet();
    else if (cooldownEndsAt) {
      cooldownReset();
      cooldownReset = startCooldown($, Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000)));
    }
  });

  window.addEventListener("beforeunload", () => cooldownReset(), { once: true });
  try {
    const me = await api("/api/customer/me");
    if (!interacted && current()) await showWallet(me);
  } catch { /* New customers and expired sessions continue with phone verification. */ }
}
