/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperSecurityPostureResponse} SuperSecurityPostureResponse */

function counterCard(label, value, tone = "") {
  const card = document.createElement("div");
  card.className = "card compact-card counter-card";
  if (tone) card.dataset.tone = tone;
  const labelEl = document.createElement("div");
  labelEl.className = "small";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "text-24-strong";
  valueEl.textContent = String(value);
  card.append(labelEl, valueEl);
  return card;
}

/**
 * Platform security posture: 24 h counters, recent events and secret rotation.
 * @param {SuperPageContext} ctx
 * @param {{ reloadBusinesses: () => Promise<void> }} deps
 */
export function createSecurityPosture(ctx, { reloadBusinesses }) {
  const { api, toast, run, element } = ctx;

  async function loadSecurityPosture() {
    await run(
      async () => {
        const out = /** @type {SuperSecurityPostureResponse} */ (
          await api("/api/super/security/posture?hours=24")
        );
        const counts = out.counts || {};
        const box = element("#securityCounters");
        box.replaceChildren();
        box.appendChild(
          counterCard("Super login fallido", Number(counts.super_login_failed || 0), "danger"),
        );
        box.appendChild(
          counterCard("Staff login fallido", Number(counts.staff_login_failed || 0), "warning"),
        );
        box.appendChild(counterCard("CSRF bloqueado", Number(counts.csrf_denied || 0), "notice"));
        box.appendChild(
          counterCard("Replay QR bloqueado", Number(counts.qr_replay_blocked || 0), "success"),
        );
        box.appendChild(
          counterCard("Webhook auth fallida", Number(counts.webhook_auth_failed || 0), "info"),
        );

        const recent = out.recent || [];
        if (!recent.length) {
          element("#securityRecent").textContent = "Sin eventos recientes.";
          return;
        }
        const lines = recent.map((event) => {
          const when = new Date(event.created_at).toLocaleString();
          return `${when} | ${event.event_type} | ${event.method || "-"} ${event.route || "-"} | ${event.ip || "-"} | ${JSON.stringify(event.meta || {})}`;
        });
        element("#securityRecent").textContent = lines.join("\n");
      },
      (error) => {
        element("#securityRecent").textContent =
          "No se pudo cargar postura de seguridad: " + error.message;
      },
    );
  }

  function bind() {
    element("#btnReload").addEventListener("click", async () => {
      await loadSecurityPosture();
      await reloadBusinesses();
    });
    element("#btnRotateSecrets").addEventListener("click", async () => {
      await run(
        async () => {
          const out = await api("/api/super/security/rotate-secrets", {
            method: "POST",
            body: "{}",
          });
          const w = Number(out?.rotated?.webhook_secrets || 0);
          const e = Number(out?.rotated?.external_award_api_keys || 0);
          toast(`Rotación completada. Webhooks: ${w}, API externas: ${e}.`);
          await loadSecurityPosture();
        },
        (error) => {
          toast("No se pudo rotar secretos: " + error.message);
        },
      );
    });
  }

  return { bind, loadSecurityPosture };
}
