import { isStrongPassword, passwordRequirementsText } from "/lib.js";

export function registerStaffModule(app) {
  const { api, $, toast, prompt } = app;
  const passwordHint = passwordRequirementsText();

  async function loadStaffMembers() {
    try {
      const out = await api("/api/admin/staff");
      const rows = out.staff || [];
      const box = $("#staffList");
      box.replaceChildren();
      if (!rows.length) {
        app.setSmallMessage(box, "No hay usuarios de personal.");
        return;
      }

      rows.forEach((s) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "8px";
        card.style.padding = "10px";

        const top = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = s.name || s.email;
        const meta = document.createElement("span");
        meta.className = "small";
        meta.textContent = ` • ${s.email || "-"} • ${s.role} • ${s.active ? "Activo" : "Inactivo"}`;
        top.append(strong, meta);
        card.appendChild(top);

        if (s.role !== "OWNER") {
          const row = document.createElement("div");
          row.className = "row";
          row.style.marginTop = "8px";

          const toggle = document.createElement("button");
          toggle.textContent = s.active ? "Desactivar" : "Activar";
          toggle.addEventListener("click", async () => {
            try {
              await api(`/api/admin/staff/${encodeURIComponent(s.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ active: !s.active })
              });
              toast(`Usuario ${!s.active ? "activado" : "desactivado"}.`);
              await loadStaffMembers();
            } catch (e) {
              toast("No se pudo actualizar: " + e.message);
            }
          });

          const reset = document.createElement("button");
          reset.textContent = "Reset contraseña";
          reset.addEventListener("click", async () => {
            const p = (await prompt(`Nueva contraseña para ${s.email}:`, {
              title: "Reset contraseña",
              inputType: "password",
              placeholder: "8+ con mayúscula, número y símbolo"
            }))?.trim();
            if (!p) return;
            if (!isStrongPassword(p)) {
              return toast(passwordHint);
            }
            try {
              await api(`/api/admin/staff/${encodeURIComponent(s.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ password: p })
              });
              toast("Contraseña actualizada.");
            } catch (e) {
              toast("No se pudo resetear: " + e.message);
            }
          });

          const giftBtn = document.createElement("button");
          giftBtn.textContent = s.can_manage_gift_cards ? "Quitar acceso Gift Cards" : "Dar acceso Gift Cards";
          giftBtn.addEventListener("click", async () => {
            try {
              await api(`/api/admin/staff/${encodeURIComponent(s.id)}`, {
                method: "PATCH",
                body: JSON.stringify({ can_manage_gift_cards: !s.can_manage_gift_cards })
              });
              toast("Permiso actualizado.");
              await loadStaffMembers();
            } catch (e) {
              toast("No se pudo actualizar permiso: " + e.message);
            }
          });

          row.append(toggle, reset, giftBtn);
          card.appendChild(row);
        }

        box.appendChild(card);
      });
    } catch (e) {
      toast("Error cargando personal: " + e.message);
    }
  }

  async function createStaffMember() {
    try {
      const payload = {
        name: $("#staffName").value.trim(),
        email: $("#staffEmail").value.trim(),
        phone: $("#staffPhone").value.trim() || undefined,
        role: $("#staffRole").value,
        password: $("#staffPassword").value,
        can_manage_gift_cards: false
      };
      if (!isStrongPassword(payload.password)) {
        return toast(passwordHint);
      }
      await api("/api/admin/staff", { method: "POST", body: JSON.stringify(payload) });
      $("#staffName").value = "";
      $("#staffEmail").value = "";
      $("#staffPhone").value = "";
      $("#staffPassword").value = "";
      toast("Usuario creado.");
      await loadStaffMembers();
    } catch (e) {
      toast("No se pudo crear usuario: " + e.message);
    }
  }

  app.onAfterPlanReady(() => {
    $("#btnCreateStaff")?.addEventListener("click", () => createStaffMember().catch(() => {}));
    $("#btnRefreshStaff")?.addEventListener("click", () => loadStaffMembers().catch(() => {}));
  });

  app.registerTab("staff", {
    feature: "staff_management",
    allowManager: false,
    load: loadStaffMembers
  });
}
