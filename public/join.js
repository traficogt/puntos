import { api, $, registerServiceWorker, toast, setHidden, hydrateShellLinks } from "/lib.js";
import { applyJoinBranding } from "./customer-branding.js";

hydrateShellLinks();

const slug = location.pathname.split("/").filter(Boolean).pop();
if (!slug) toast("Falta slug");
let cooldownTimer = null;
let cooldownLeft = 0;

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

try {
  const b = await api("/api/public/business/" + slug);
  localStorage.setItem("pf_customer_slug", slug);
  applyJoinBranding($, b);
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
