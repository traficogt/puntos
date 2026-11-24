/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */

/**
 * The super admin's own account: password reset, email change, re-authentication,
 * MFA and lockdown.
 * @param {SuperPageContext} ctx
 * @param {{ loadMe: () => Promise<void> }} deps
 */
export function bindAccountSecurity(ctx, { loadMe }) {
  const { api, toast, run, element, input } = ctx;

  /**
   * @param {string | null | undefined} secret
   * @param {string} [otpauthUri]
   */
  function setPendingSuperMfa(secret, otpauthUri = "") {
    const pendingSuperMfaSecret = String(secret || "").trim();
    const box = element("#superMfaSecret");
    if (!pendingSuperMfaSecret) {
      box.textContent = "(sin secreto pendiente)";
      return;
    }
    box.textContent = `Secreto: ${pendingSuperMfaSecret}${otpauthUri ? `\n\nURI: ${otpauthUri}` : ""}`;
  }

  /**
   * @param {string} selector
   * @param {() => Promise<unknown>} action
   */
  function bindAction(selector, action) {
    element(selector).addEventListener("click", async () => {
      await run(action, (error) => {
        toast(error.message);
      });
    });
  }

  bindAction("#btnRequestSuperReset", async () => {
    const email = input("#email").value.trim();
    if (!email) return toast("Escribe el correo del super admin.");
    await api("/api/public/super/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    toast("Si el correo coincide, enviamos un token de reset.");
  });

  bindAction("#btnConfirmSuperReset", async () => {
    const token = input("#superResetToken").value.trim();
    const newPassword = input("#superResetPassword").value;
    if (!token || !newPassword) return toast("Completa token y nueva contraseña.");
    await api("/api/public/super/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });
    input("#superResetToken").value = "";
    input("#superResetPassword").value = "";
    toast("Contraseña actualizada.");
  });

  bindAction("#btnConfirmSuperEmail", async () => {
    const token = input("#superEmailToken").value.trim();
    if (!token) return toast("Escribe el token recibido.");
    await api("/api/public/super/email-change/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    input("#superEmailToken").value = "";
    toast("Cambio de correo confirmado.");
  });

  bindAction("#btnSuperReauth", async () => {
    const password = input("#superReauthPassword").value;
    if (!password) return toast("Escribe tu contraseña actual.");
    await api("/api/super/security/reauth", {
      method: "POST",
      body: JSON.stringify({
        password,
        ...(input("#superReauthMfaCode").value.trim()
          ? { mfaCode: input("#superReauthMfaCode").value.trim() }
          : {}),
      }),
    });
    toast("Sesión revalidada.");
  });

  bindAction("#btnSuperMfaEnroll", async () => {
    const out = await api("/api/super/security/mfa/enroll", { method: "POST", body: "{}" });
    setPendingSuperMfa(out.secret, out.otpauth_uri || "");
    toast("Se generó un secreto MFA. Confirma con el código.");
  });

  bindAction("#btnSuperMfaConfirm", async () => {
    const code = input("#superMfaConfirmCode").value.trim();
    if (!code) return toast("Escribe el código MFA.");
    await api("/api/super/security/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    input("#superMfaConfirmCode").value = "";
    setPendingSuperMfa("");
    toast("MFA activado.");
  });

  bindAction("#btnSuperMfaDisable", async () => {
    await api("/api/super/security/mfa/disable", { method: "POST", body: "{}" });
    setPendingSuperMfa("");
    toast("MFA desactivado.");
    await loadMe();
  });

  bindAction("#btnSuperEmailChange", async () => {
    const newEmail = input("#superNewEmail").value.trim();
    if (!newEmail) return toast("Escribe el nuevo correo.");
    await api("/api/super/security/email-change", {
      method: "POST",
      body: JSON.stringify({ newEmail }),
    });
    toast("Cambio solicitado. Revisa ambos correos.");
  });

  bindAction("#btnSuperLockdown", async () => {
    await api("/api/super/security/lockdown", { method: "POST", body: "{}" });
    toast("Sesiones revocadas por seguridad.");
    await loadMe();
  });
}
