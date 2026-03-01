export function registerReferralsModule(app) {
  const { api, $, toast } = app;

  async function loadReferrals() {
    try {
      const settings = await api("/api/admin/referral-settings");
      $("#refEnabled").checked = settings.settings?.enabled || false;
      $("#refReferrerPoints").value = settings.settings?.referrer_reward_points || 100;
      $("#refReferredPoints").value = settings.settings?.referred_reward_points || 50;
      $("#refMinPurchase").value = settings.settings?.min_purchase_to_complete || 0;
      $("#refRewardOnSignup").checked = settings.settings?.reward_on_signup || false;

      const leaderboard = await api("/api/admin/referral-leaderboard?limit=10");
      const container = $("#refLeaderboard");
      container.replaceChildren();

      if (!leaderboard.leaderboard || leaderboard.leaderboard.length === 0) {
        container.textContent = "No hay referidores todavía.";
      } else {
        leaderboard.leaderboard.forEach((ref, i) => {
          const div = document.createElement("div");
          div.appendChild(document.createTextNode(`${i + 1}. `));

          const strong = document.createElement("strong");
          strong.textContent = ref.name;
          div.appendChild(strong);

          div.appendChild(document.createTextNode(` - ${ref.referral_count} referidos (${ref.total_points} pts)`));
          container.appendChild(div);
        });
      }

      const stats = $("#refStats");
      stats.replaceChildren();
      const k = document.createElement("div");
      k.className = "kpi";
      k.textContent = String(leaderboard.leaderboard?.length || 0);
      const s = document.createElement("div");
      s.className = "small";
      s.textContent = "Referidores activos";
      stats.append(k, s);
    } catch (e) {
      toast("Error cargando referidos: " + e.message);
    }
  }

  async function saveRefSettings() {
    try {
      const settingsData = {
        enabled: $("#refEnabled").checked,
        referrer_reward_points: parseInt($("#refReferrerPoints").value, 10),
        referred_reward_points: parseInt($("#refReferredPoints").value, 10),
        min_purchase_to_complete: parseFloat($("#refMinPurchase").value) || null,
        reward_on_signup: $("#refRewardOnSignup").checked
      };

      await api("/api/admin/referral-settings", {
        method: "PUT",
        body: JSON.stringify(settingsData)
      });

      toast("Configuración guardada");
    } catch (e) {
      toast("Error: " + e.message);
    }
  }

  app.onAfterPlanReady(() => {
    $("#btnSaveRefSettings")?.addEventListener("click", () => saveRefSettings().catch(() => {}));
  });

  app.registerTab("referrals", {
    feature: "referrals",
    allowManager: false,
    load: loadReferrals
  });
}

