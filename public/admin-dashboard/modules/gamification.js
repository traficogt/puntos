export function registerGamificationModule(app) {
  const { api, $, toast, confirm } = app;

  async function run(task, onError) {
    try {
      return await task();
    } catch (error) {
      onError(error);
      return null;
    }
  }

  function fire(task) {
    return () => {
      task().catch(() => {});
    };
  }

  async function loadAchievements() {
    await run(async () => {
      const data = await api("/api/admin/achievements");
      const container = $("#achievementsList");
      container.replaceChildren();

      if (!data.achievements || data.achievements.length === 0) {
        app.setSmallMessage(container, "No hay logros configurados.");
        return;
      }

      data.achievements.forEach((ach) => {
        const div = document.createElement("div");
        div.className = "card";
        div.style.marginBottom = "12px";

        const top = document.createElement("div");
        top.className = "row";
        top.style.justifyContent = "space-between";
        top.style.alignItems = "start";

        const left = document.createElement("div");
        const h = document.createElement("h3");
        h.textContent = `${ach.icon_url || "🏆"} ${ach.name}`;
        const p = document.createElement("p");
        p.className = "small";
        p.textContent = ach.description || "";
        const badges = document.createElement("div");
        badges.className = "row";
        badges.style.gap = "8px";
        badges.style.marginTop = "4px";

        const b1 = document.createElement("span");
        b1.className = "badge";
        b1.textContent = `Requisito: ${ach.requirement_type} = ${ach.requirement_value}`;
        const b2 = document.createElement("span");
        b2.className = "badge";
        b2.textContent = `+${ach.points_reward} pts`;
        const b3 = document.createElement("span");
        b3.className = "badge";
        b3.textContent = ach.active ? "✅ Activo" : "❌ Inactivo";
        badges.append(b1, b2, b3);
        left.append(h, p, badges);

        const right = document.createElement("div");
        right.className = "row";
        right.style.gap = "8px";

        const toggle = document.createElement("button");
        toggle.className = "secondary";
        toggle.textContent = ach.active ? "Desactivar" : "Activar";
        toggle.addEventListener("click", async () => {
          await run(async () => {
            await api(`/api/admin/achievements/${encodeURIComponent(ach.id)}`, {
              method: "PUT",
              body: JSON.stringify({ active: !ach.active })
            });
            toast(ach.active ? "Logro desactivado" : "Logro activado");
            await loadAchievements();
          }, (error) => {
            toast("Error: " + error.message);
          });
        });

        const del = document.createElement("button");
        del.textContent = "Eliminar";
        del.addEventListener("click", async () => {
          const ok = await confirm("¿Eliminar este logro?", { title: "Eliminar logro" });
          if (!ok) return;
          await run(async () => {
            await api(`/api/admin/achievements/${encodeURIComponent(ach.id)}`, { method: "DELETE" });
            toast("Logro eliminado");
            await loadAchievements();
          }, (error) => {
            toast("Error: " + error.message);
          });
        });

        right.append(toggle, del);
        top.append(left, right);
        div.appendChild(top);
        container.appendChild(div);
      });
    }, (error) => {
      toast("Error cargando logros: " + error.message);
    });
  }

  async function createAchievement() {
    await run(async () => {
      const achData = {
        name: $("#achName").value.trim(),
        description: $("#achDesc").value.trim(),
        icon_url: $("#achIcon").value.trim() || "🏆",
        requirement_type: $("#achReqType").value,
        requirement_value: parseInt($("#achReqValue").value, 10),
        points_reward: parseInt($("#achReward").value, 10),
        active: true
      };

      await api("/api/admin/achievements", {
        method: "POST",
        body: JSON.stringify(achData)
      });

      toast("Logro creado");
      $("#achievementModal").style.display = "none";
      await loadAchievements();
    }, (error) => {
      toast("Error: " + error.message);
    });
  }

  async function loadChallenges() {
    await run(async () => {
      const data = await api("/api/admin/challenges");
      const container = $("#challengesList");
      container.replaceChildren();

      if (!data.challenges || data.challenges.length === 0) {
        app.setSmallMessage(container, "No hay retos activos.");
        return;
      }

      data.challenges.forEach((chal) => {
        const div = document.createElement("div");
        div.className = "card";
        div.style.marginBottom = "12px";

        const startDate = new Date(chal.start_date).toLocaleDateString();
        const endDate = chal.end_date ? new Date(chal.end_date).toLocaleDateString() : "Sin límite";

        const row = document.createElement("div");
        row.className = "row";
        row.style.justifyContent = "space-between";

        const left = document.createElement("div");
        const h = document.createElement("h3");
        h.textContent = chal.name;
        const p = document.createElement("p");
        p.className = "small";
        p.textContent = chal.description || "";
        const badges = document.createElement("div");
        badges.className = "row";
        badges.style.gap = "8px";
        badges.style.marginTop = "4px";
        [chal.challenge_type, `${chal.requirement_type}: ${chal.requirement_value}`, `+${chal.reward_points} pts`, `${startDate} - ${endDate}`]
          .forEach((txt) => {
            const b = document.createElement("span");
            b.className = "badge";
            b.textContent = txt;
            badges.appendChild(b);
          });
        left.append(h, p, badges);

        const del = document.createElement("button");
        del.textContent = "Eliminar";
        del.addEventListener("click", async () => {
          const ok = await confirm("¿Eliminar este reto?", { title: "Eliminar reto" });
          if (!ok) return;
          await run(async () => {
            await api(`/api/admin/challenges/${encodeURIComponent(chal.id)}`, { method: "DELETE" });
            toast("Reto eliminado");
            await loadChallenges();
          }, (error) => {
            toast("Error: " + error.message);
          });
        });

        row.append(left, del);
        div.appendChild(row);
        container.appendChild(div);
      });
    }, (error) => {
      toast("Error cargando retos: " + error.message);
    });
  }

  async function createChallenge() {
    await run(async () => {
      const chalData = {
        name: $("#chalName").value.trim(),
        description: $("#chalDesc").value.trim(),
        challenge_type: $("#chalType").value,
        requirement_type: $("#chalReqType").value,
        requirement_value: parseInt($("#chalReqValue").value, 10),
        reward_points: parseInt($("#chalReward").value, 10),
        start_date: $("#chalStartDate").value,
        end_date: $("#chalEndDate").value || null,
        recurrence: $("#chalRecurrence").value || null,
        active: true
      };

      await api("/api/admin/challenges", {
        method: "POST",
        body: JSON.stringify(chalData)
      });

      toast("Reto creado");
      $("#challengeModal").style.display = "none";
      await loadChallenges();
    }, (error) => {
      toast("Error: " + error.message);
    });
  }

  function initModals() {
    $("#btnAddAchievement")?.addEventListener("click", () => {
      $("#achName").value = "";
      $("#achDesc").value = "";
      $("#achIcon").value = "";
      $("#achReqType").value = "visits";
      $("#achReqValue").value = "";
      $("#achReward").value = "50";
      $("#achievementModal").style.display = "block";
    });

    $("#btnSaveAchievement")?.addEventListener("click", fire(createAchievement));
    $("#btnCancelAchievement")?.addEventListener("click", () => { $("#achievementModal").style.display = "none"; });

    $("#btnAddChallenge")?.addEventListener("click", () => {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      $("#chalStartDate").value = now.toISOString().slice(0, 16);

      $("#chalName").value = "";
      $("#chalDesc").value = "";
      $("#chalType").value = "limited_time";
      $("#chalReqType").value = "visits";
      $("#chalReqValue").value = "3";
      $("#chalReward").value = "100";
      $("#chalEndDate").value = "";
      $("#chalRecurrence").value = "";
      $("#challengeModal").style.display = "block";
    });

    $("#btnSaveChallenge")?.addEventListener("click", fire(createChallenge));
    $("#btnCancelChallenge")?.addEventListener("click", () => { $("#challengeModal").style.display = "none"; });
  }

  app.onAfterPlanReady(() => {
    initModals();
  });

  app.registerTab("achievements", {
    feature: "gamification",
    allowManager: false,
    load: loadAchievements
  });

  app.registerTab("challenges", {
    feature: "gamification",
    allowManager: false,
    load: loadChallenges
  });
}
