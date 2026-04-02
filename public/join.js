import { api, $, registerServiceWorker, toast, setHidden, hydrateShellLinks } from "/lib.js";
import { applyJoinBranding } from "./customer-branding.js";

hydrateShellLinks();

const slug = location.pathname.split("/").filter(Boolean).pop();
if (!slug) toast("Falta slug");
let cooldownTimer = null;
let cooldownLeft = 0;
const returningSlugKey = "pf_customer_joined_slug";
const searchParams = new URLSearchParams(location.search);
const entryReason = (searchParams.get("motivo") || "").trim();

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

function startCooldown(seconds = 30) {
  clearInterval(cooldownTimer);
  cooldownLeft = seconds;
  $("#btnCode").disabled = true;
  const tick = () => {
    if (cooldownLeft <= 0) {
      $("#btnCode").disabled = false;
      $("#codeCooldownInfo").textContent = "";
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      return;
    }
    $("#codeCooldownInfo").textContent = `Puedes reenviar en ${cooldownLeft}s`;
    cooldownLeft -= 1;
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

function setEntryState(mode, businessName = "") {
  const title = $("#title");
  const subtitle = $("#subtitle");
  const doneTitle = $("#doneTitle");
  const doneSubtitle = $("#doneSubtitle");
  const poweredBy = $("#customerPoweredBy");
  const entryContext = $("#joinEntryContext");
  const isReturning = mode === "session-expired" || mode === "logged-out";

  if (title) {
    title.textContent = isReturning
      ? "Vuelve a entrar a tu tarjeta"
      : "Registrarte";
  }
  if (subtitle) {
    if (mode === "session-expired") {
      subtitle.textContent = `Tu sesión anterior de ${businessName || "este negocio"} ya venció. Solicita un nuevo código para volver a abrir tu tarjeta.`;
    } else if (mode === "logged-out") {
      subtitle.textContent = `Cerraste tu sesión de ${businessName || "este negocio"}. Solicita un nuevo código si quieres volver a entrar desde este navegador.`;
    } else {
      subtitle.textContent = "Confirma tu teléfono y activamos tu tarjeta del negocio en este mismo momento.";
    }
  }
  if (doneTitle) {
    doneTitle.textContent = isReturning
      ? "Tarjeta reactivada."
      : "Tu tarjeta ya está activa.";
  }
  if (doneSubtitle) {
    doneSubtitle.textContent = isReturning
      ? "En breve abrimos tu vista de cliente otra vez para que sigas usando tu tarjeta."
      : "En breve abrimos tu vista de cliente para que puedas mostrar tu QR y ver tus puntos.";
  }
  if (entryContext) {
    if (mode === "session-expired") {
      entryContext.textContent = "Tu sesión venció en este navegador. Vuelve a verificar tu teléfono para reabrir tu tarjeta.";
      entryContext.classList.remove("is-hidden");
      setFeedback("#joinRequestFeedback", "Solicita un código nuevo para volver a entrar.");
      setFeedback("#joinVerifyFeedback", "Cuando recibas el código, verifícalo para abrir tu tarjeta otra vez.");
    } else if (mode === "logged-out") {
      entryContext.textContent = "Tu sesión se cerró. Si quieres volver a entrar aquí, solicita un nuevo código.";
      entryContext.classList.remove("is-hidden");
      setFeedback("#joinRequestFeedback", "Solicita un nuevo código para volver a entrar.");
      setFeedback("#joinVerifyFeedback", "");
    } else {
      entryContext.textContent = "";
      entryContext.classList.add("is-hidden");
    }
  }
  if (poweredBy) {
    poweredBy.textContent = "Powered by PuntosFieles";
  }
}

try {
  const b = await api("/api/public/business/" + slug);
  localStorage.setItem("pf_customer_slug", slug);
  const hasReturnedBefore = typeof localStorage !== "undefined"
    && localStorage.getItem(returningSlugKey) === slug;
  applyJoinBranding($, b);
  const resolvedReason = entryReason === "sesion-vencida"
    ? "session-expired"
    : entryReason === "salida"
      ? "logged-out"
      : hasReturnedBefore
        ? "session-expired"
        : "first-time";
  setEntryState(resolvedReason, b.businessName);
} catch {
  toast("Negocio no encontrado");
}
setStep(1);

$("#phone").value = localStorage.getItem("pf_phone") || "";

$("#btnCode").addEventListener("click", async () => {
  try {
    const phone = $("#phone").value.trim();
    if (!phone) {
      setFeedback("#joinRequestFeedback", "Escribe el teléfono para recibir el código.");
      return toast("Escribe el teléfono");
    }
    setFeedback("#joinRequestFeedback", "Enviando código...");
    localStorage.setItem("pf_phone", phone);
    const name = $("#name").value.trim() || undefined;
    await api("/api/public/business/" + slug + "/join/request-code", {
      method: "POST",
      body: JSON.stringify({ phone, name })
    });
    $("#codeInfo").textContent = "Código enviado por mensaje.";
    setFeedback("#joinRequestFeedback", "Código enviado. Escríbelo abajo para activar tu tarjeta.");
    setStep(2);
    startCooldown(30);
    $("#code").focus();
    toast("Código enviado.");
  } catch (e) {
    setFeedback("#joinRequestFeedback", e.message || "No se pudo enviar el código.");
    toast(e.message);
  }
});

$("#btnVerify").addEventListener("click", async () => {
  try {
    const phone = $("#phone").value.trim();
    const code = $("#code").value.trim();
    const name = $("#name").value.trim() || undefined;
    if (!phone || !code) {
      setFeedback("#joinVerifyFeedback", "Escribe el teléfono y el código recibido.");
      return toast("Falta teléfono o código");
    }
    setFeedback("#joinVerifyFeedback", "Verificando código...");
    await api("/api/public/business/" + slug + "/join/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code, name })
    });
    localStorage.setItem(returningSlugKey, slug);
    setHidden($("#done"), false);
    setStep(3);
    setFeedback("#joinVerifyFeedback", "Tarjeta activada. Abriendo tu vista de cliente...");
    toast("Verificado. Abriendo tu tarjeta...");
    setTimeout(() => {
      location.href = "/c";
    }, 650);
  } catch (e) {
    setFeedback("#joinVerifyFeedback", e.message || "No se pudo verificar el código.");
    toast(e.message);
  }
});

registerServiceWorker().catch(() => {});
