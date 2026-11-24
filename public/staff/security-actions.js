/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Account security actions for the signed-in staff member (re-authentication,
 * MFA enrolment, lockdown) and the owner-only analytics peek.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession> }} deps
 */
export function bindSecurityActions(ctx, { session }) {
  const { api, toast, state, run, element, input } = ctx;

  /**
   * @param {string | null | undefined} secret
   * @param {string} [otpauthUri]
   */
  function setPendingStaffMfa(secret, otpauthUri = "") {
    const pendingStaffMfaSecret = String(secret || "").trim();
    const box = element("#staffMfaSecret");
    if (!pendingStaffMfaSecret) {
      box.textContent = "(sin secreto pendiente)";
      return;
    }
    box.textContent = `Secreto: ${pendingStaffMfaSecret}${otpauthUri ? `\n\nURI: ${otpauthUri}` : ""}`;
  }

  /**
   * Runs an online-only security action after the session has been validated.
   * @param {string} selector
   * @param {() => Promise<unknown>} action
   */
  function bindOnlineAction(selector, action) {
    element(selector).addEventListener("click", async () => {
      await run(
        async () => {
          if (!(await session.ensureAuth()) || !state.sessionOnline) return;
          await action();
        },
        (error) => {
          toast(error.message);
        },
      );
    });
  }

  bindOnlineAction("#btnStaffReauth", async () => {
    const password = input("#staffReauthPassword").value;
    if (!password) return toast("Escribe tu contraseña actual.");
    await api("/api/staff/security/reauth", {
      method: "POST",
      body: JSON.stringify({
        password,
        ...(input("#staffReauthMfaCode").value.trim()
          ? { mfaCode: input("#staffReauthMfaCode").value.trim() }
          : {}),
      }),
    });
    toast("Sesión revalidada.");
  });

  bindOnlineAction("#btnStaffMfaEnroll", async () => {
    const out = await api("/api/staff/security/mfa/enroll", { method: "POST", body: "{}" });
    setPendingStaffMfa(out.secret, out.otpauth_uri || "");
    toast("Se generó un secreto MFA. Confirma con el código.");
  });

  bindOnlineAction("#btnStaffMfaConfirm", async () => {
    const code = input("#staffMfaConfirmCode").value.trim();
    if (!code) return toast("Escribe el código MFA.");
    await api("/api/staff/security/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    input("#staffMfaConfirmCode").value = "";
    setPendingStaffMfa("");
    toast("MFA activado.");
  });

  bindOnlineAction("#btnStaffMfaDisable", async () => {
    await api("/api/staff/security/mfa/disable", { method: "POST", body: "{}" });
    setPendingStaffMfa("");
    toast("MFA desactivado.");
  });

  bindOnlineAction("#btnStaffLockdown", async () => {
    await api("/api/staff/security/lockdown", { method: "POST", body: "{}" });
    session.clearOfflineSnapshot();
    toast("Sesiones revocadas por seguridad.");
    setTimeout(() => (location.href = "/equipo/ingresar/"), 600);
  });

  element("#btnSummary").addEventListener("click", async () => {
    await run(
      async () => {
        const out = await api("/api/admin/analytics/summary");
        element("#summary").textContent = JSON.stringify(out, null, 2);
      },
      (error) => {
        toast(error.message);
      },
    );
  });
}
