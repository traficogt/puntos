import { api, $, toast, setHidden, hydrateShellLinks } from "/lib.js";
import { applyJoinBranding } from "./customer-branding.js";

const returningSlugKey = "pf_customer_joined_slug";

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

function startCooldown($, seconds = 30) {
  let cooldownLeft = seconds;
  let cooldownTimer = null;
  const codeButton = $("#btnCode");
  const cooldownInfo = $("#codeCooldownInfo");
  if (!codeButton) return () => {};

  codeButton.disabled = true;
  const tick = () => {
    if (cooldownLeft <= 0) {
      codeButton.disabled = false;
      if (cooldownInfo) cooldownInfo.textContent = "";
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      return;
    }
    if (cooldownInfo) cooldownInfo.textContent = `Puedes reenviar en ${cooldownLeft}s`;
    cooldownLeft -= 1;
  };

  tick();
  cooldownTimer = setInterval(tick, 1000);
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
    doneSubtitle.textContent = isLogin
      ? "En breve abrimos tu vista de cliente otra vez para que sigas usando tu tarjeta."
      : "En breve abrimos tu vista de cliente para que puedas mostrar tu QR y ver tus puntos.";
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
      if (entryReason === "session-expired") {
        entryContext.textContent = `Tu sesión anterior de ${safeBusinessName} ya venció. Solicita un nuevo código para volver a abrir tu tarjeta.`;
      } else if (entryReason === "logged-out") {
        entryContext.textContent = `Cerraste tu sesión de ${safeBusinessName}. Solicita un nuevo código si quieres volver a entrar desde este navegador.`;
      } else {
        entryContext.textContent = "Recibe un código y vuelve a abrir tu tarjeta desde este navegador.";
      }
      entryContext.classList.remove("is-hidden");
      setFeedback("#joinRequestFeedback", "Solicita un nuevo código para ingresar.");
      setFeedback("#joinVerifyFeedback", "Cuando recibas el código, verifícalo para abrir tu tarjeta.");
    } else {
      entryContext.textContent = "¿Ya tienes tarjeta? Usa la página de ingreso para volver a entrar.";
      entryContext.classList.remove("is-hidden");
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
  if (mode === "register" && (entryReason === "session-expired" || entryReason === "logged-out")) {
    location.replace(`/ingresar/${encodeURIComponent(slug)}${entryReason ? `?motivo=${encodeURIComponent(entryReason)}` : ""}`);
    return;
  }

  let cooldownReset = () => {};

  try {
    const business = await api("/api/public/business/" + slug);
    localStorage.setItem("pf_customer_slug", slug);
    const branding = applyJoinBranding($, business);
    setModeCopy(mode, branding.businessName, entryReason);
  } catch {
    toast("Negocio no encontrado");
    return;
  }

  setStep(1);
  $("#phone").value = localStorage.getItem("pf_phone") || "";

  $("#btnCode").addEventListener("click", async () => {
    try {
      const phone = $("#phone").value.trim();
      const email = $("#email")?.value.trim() || undefined;
      if (!phone) {
        setFeedback("#joinRequestFeedback", "Escribe el teléfono para recibir el código.");
        return toast("Escribe el teléfono");
      }
      setFeedback("#joinRequestFeedback", "Enviando código...");
      localStorage.setItem("pf_phone", phone);
      const name = $("#name").value.trim() || undefined;
      await api("/api/public/business/" + slug + "/join/request-code", {
        method: "POST",
        body: JSON.stringify({ phone, email, name })
      });
      $("#codeInfo").textContent = "Código enviado por WhatsApp o correo.";
      setFeedback("#joinRequestFeedback", "Código enviado. Escríbelo abajo para continuar.");
      setStep(2);
      cooldownReset();
      cooldownReset = startCooldown($, 30);
      $("#code").focus();
      toast("Código enviado.");
    } catch (e) {
      const message = e?.message || "No se pudo enviar el código.";
      setFeedback("#joinRequestFeedback", message);
      toast(message);
    }
  });

  $("#btnVerify").addEventListener("click", async () => {
    try {
      const phone = $("#phone").value.trim();
      const email = $("#email")?.value.trim() || undefined;
      const code = $("#code").value.trim();
      const name = $("#name").value.trim() || undefined;
      if (!phone || !code) {
        setFeedback("#joinVerifyFeedback", "Escribe el teléfono y el código recibido.");
        return toast("Falta teléfono o código");
      }
      setFeedback("#joinVerifyFeedback", "Verificando código...");
      await api("/api/public/business/" + slug + "/join/verify", {
        method: "POST",
        body: JSON.stringify({ phone, email, code, name })
      });
      localStorage.setItem(returningSlugKey, slug);
      setHidden($("#done"), false);
      setStep(3);
      setFeedback("#joinVerifyFeedback", mode === "login"
        ? "Tarjeta reabierta. Abriendo tu vista de cliente..."
        : "Tarjeta activada. Abriendo tu vista de cliente...");
      toast(mode === "login" ? "Verificado. Abriendo tu tarjeta..." : "Verificado. Abriendo tu tarjeta...");
      setTimeout(() => {
        location.href = "/c";
      }, 650);
    } catch (e) {
      const message = e?.message || "No se pudo verificar el código.";
      setFeedback("#joinVerifyFeedback", message);
      toast(message);
    }
  });

  window.addEventListener("beforeunload", () => cooldownReset(), { once: true });
}
