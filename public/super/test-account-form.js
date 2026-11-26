/** @param {import("./types.js").SuperPageContext} ctx @param {string} businessId @param {() => Promise<void>} reloadBusinesses */
export function testAccountForm({ api, toast, run }, businessId, reloadBusinesses) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Administrar cuentas de prueba";
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "ID de la tarjeta del cliente";
  const id = document.createElement("input");
  id.required = true;
  id.pattern = "[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}";
  label.appendChild(id);
  const action = document.createElement("select");
  action.add(new Option("Marcar como cuenta de prueba", "true"));
  action.add(new Option("Quitar marca de cuenta de prueba", "false"));
  action.setAttribute("aria-label", "Acción sobre la cuenta");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Guardar marca";
  form.append(label, action, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await run(
        async () => {
          await api(
            `/api/super/businesses/${encodeURIComponent(businessId)}/customers/${encodeURIComponent(id.value.trim())}/test-account`,
            {
              method: "PATCH",
              body: JSON.stringify({ is_test: action.value === "true" }),
            },
          );
          toast("Marca guardada.");
          await reloadBusinesses();
        },
        (error) => toast("No se pudo guardar la marca: " + error.message),
      );
    } finally {
      save.disabled = false;
    }
  });
  details.append(summary, form);
  return details;
}
