import { api, $, toast } from "/lib.js";

const slug = location.pathname.split("/").filter(Boolean).pop();
if (!slug) toast("Falta slug");
let cooldownTimer = null;
let cooldownLeft = 0;

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
  $("#title").textContent = "Registrarte en " + b.name;
  $("#subtitle").textContent = "Gana puntos en " + b.name + ".";
  document.title = "Registro • " + b.name;
} catch {
  toast("Negocio no encontrado");
}
setStep(1);

$("#phone").value = localStorage.getItem("pf_phone") || "";

$("#btnCode").addEventListener("click", async () => {
  try {
    const phone = $("#phone").value.trim();
    localStorage.setItem("pf_phone", phone);
    const name = $("#name").value.trim() || undefined;
    const out = await api("/api/public/business/" + slug + "/join/request-code", {
      method: "POST",
      body: JSON.stringify({ phone, name })
    });
    $("#codeInfo").textContent = "Enviado. Vence: " + new Date(out.expiresAt).toLocaleTimeString();
    setStep(2);
    startCooldown(30);
    $("#code").focus();
    toast("Código enviado.");
  } catch (e) {
    toast(e.message);
  }
});

$("#btnVerify").addEventListener("click", async () => {
  try {
    const phone = $("#phone").value.trim();
    const code = $("#code").value.trim();
    const name = $("#name").value.trim() || undefined;
    await api("/api/public/business/" + slug + "/join/verify", {
      method: "POST",
      body: JSON.stringify({ phone, code, name })
    });
    $("#done").style.display = "block";
    setStep(3);
    toast("Verificado. Abriendo tu tarjeta...");
    setTimeout(() => {
      location.href = "/c";
    }, 650);
  } catch (e) {
    toast(e.message);
  }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
