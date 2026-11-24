import { api } from "./lib.js";
const categories = {
  product: "Un producto",
  reward: "Una recompensa",
  availability: "Disponibilidad",
  service: "Un servicio",
  other: "Otra idea",
};
/** @type {Record<string, string>} */
const states = {
  new: "Recibida",
  reviewing: "En revisión",
  planned: "Planificada",
  available: "Disponible",
  declined: "No prevista",
};
/**
 * @typedef {{
 *   category: string,
 *   topic: string,
 *   note: string,
 *   reward_id: string | null,
 *   product_context: string | null,
 *   customer_id?: string | null,
 * }} DemandNotebookBody
 */

/**
 * One mounted form per session; staff links the currently selected member only.
 * @param {{
 *   container: Element | null,
 *   source?: string,
 *   getContext?: () => { customerId?: string | null, rewardId?: string | null },
 *   request?: (path: string, options?: RequestInit) => Promise<Record<string, unknown> | null>,
 * }} options
 */
export function mountDemandNotebook({
  container,
  source = "customer",
  getContext = () => ({}),
  request = api,
}) {
  if (!container || !["staff", "customer"].includes(source))
    return { ready: Promise.resolve(), refresh: async () => {}, setPaused() {}, destroy() {} };
  if (!document.getElementById("pf-demand-notebook-style")) {
    const link = document.createElement("link");
    link.id = "pf-demand-notebook-style";
    link.rel = "stylesheet";
    link.href = "/styles/demand-notebook.css";
    document.head.append(link);
  }
  const prefix = `demand-${crypto.randomUUID()}`,
    abort = new AbortController();
  let busy = false,
    paused = false,
    refreshError = "";
  /** @type {{ key: string, body: DemandNotebookBody & { request_id: string } } | null} */
  let pending = null;
  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string} [text]
   * @returns {HTMLElementTagNameMap[K]}
   */
  const make = (tag, text) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const section = make("section");
  section.className = "demand-notebook";
  section.setAttribute("aria-labelledby", `${prefix}-title`);
  const title = make("h2", source === "staff" ? "Anotar un pedido" : "¿Qué te gustaría encontrar?");
  title.id = `${prefix}-title`;
  section.append(
    title,
    make(
      "p",
      source === "staff"
        ? "Registra lo que pidió una persona. Si seleccionaste un cliente, su pedido contará una sola vez por tema."
        : "Comparte una idea con este negocio. Es un pedido para revisar, sin compromiso de compra ni garantía de disponibilidad.",
    ),
  );
  const form = make("form");
  /** @type {Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */
  const fields = {};
  /**
   * @template {"input" | "select" | "textarea"} [K="input"]
   * @param {string} name
   * @param {string} label
   * @param {K} [tag]
   * @returns {HTMLElementTagNameMap[K]}
   */
  function field(name, label, tag = /** @type {K} */ ("input")) {
    const wrapper = make("div"),
      control = make(tag),
      id = `${prefix}-${name}`;
    control.id = id;
    control.name = name;
    const text = make("label", label);
    text.htmlFor = id;
    wrapper.append(text, control);
    form.append(wrapper);
    fields[name] = control;
    return control;
  }
  const category = field("category", "¿Qué estás pidiendo?", "select");
  for (const [value, label] of Object.entries(categories)) {
    const option = make("option", label);
    option.value = value;
    category.append(option);
  }
  const topic = field("topic", "Pedido breve");
  topic.required = true;
  topic.minLength = 3;
  topic.maxLength = 120;
  topic.placeholder = "Por ejemplo, café sin azúcar";
  const reward = field("reward_id", "Recompensa relacionada (opcional)", "select");
  const none = make("option", "Sin recompensa");
  none.value = "";
  reward.append(none);
  const context = field("product_context", "Producto o contexto (opcional)");
  context.maxLength = 200;
  const note = field("note", "Detalle (opcional)", "textarea");
  note.maxLength = 1000;
  note.rows = 2;
  const notice = make("p");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const submit = make("button", "Guardar pedido");
  submit.type = "submit";
  submit.className = "btn btn-primary";
  const reload = make("button", "Actualizar pedidos");
  reload.type = "button";
  reload.className = "btn btn-secondary";
  const history = make("div");
  form.append(submit);
  section.append(form, notice, reload, history);
  container.append(section);
  /** @param {boolean} value */
  function setPaused(value) {
    paused = Boolean(value);
    submit.disabled = paused || busy;
    reload.disabled = paused;
  }
  async function refresh() {
    if (paused || abort.signal.aborted) return;
    try {
      const data = await request(`/api/${source}/demand-notebook`, {
        cache: "no-store",
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (refreshError && notice.textContent === refreshError) notice.textContent = "";
      refreshError = "";
      const selectedReward = reward.value || getContext().rewardId;
      const previousLabel = /** @type {HTMLOptionElement[]} */ ([...reward.children]).find(
        (option) => option.value === selectedReward,
      )?.textContent;
      reward.replaceChildren(none);
      const rewards = Array.isArray(data?.rewards) ? data?.rewards : [];
      for (const row of rewards) {
        const option = make("option", row.name);
        option.value = row.id;
        reward.append(option);
      }
      if (rewards.some((row) => row.id === selectedReward))
        reward.value = /** @type {string} */ (selectedReward);
      else if (selectedReward && pending?.body.reward_id === selectedReward) {
        // A catalog change must not change the body/key of an uncertain retry.
        const label = previousLabel?.endsWith(" (envío pendiente)")
          ? previousLabel
          : `${previousLabel || "Recompensa"} (envío pendiente)`;
        const option = make("option", label);
        option.value = selectedReward;
        option.disabled = true;
        reward.append(option);
        reward.value = selectedReward;
      }
      history.replaceChildren();
      const requests = Array.isArray(data?.requests) ? data?.requests : [];
      if (source === "customer" && requests.length) {
        history.append(make("h3", "Tus pedidos"));
        const list = make("ul");
        for (const row of requests) {
          const item = make("li", `${row.topic} · ${states[row.status] ?? row.status}`);
          list.append(item);
        }
        history.append(list);
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        refreshError =
          (error instanceof Error && error.message) ||
          "No pudimos cargar los pedidos. Actualiza para intentar otra vez.";
        notice.textContent = refreshError;
      }
    }
  }
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (busy || paused || abort.signal.aborted || !form.reportValidity()) return;
      const selected = getContext(),
        body = {
          category: category.value,
          topic: topic.value.trim(),
          note: note.value.trim(),
          reward_id: reward.value || null,
          product_context: context.value.trim() || null,
          ...(source === "staff" ? { customer_id: selected.customerId ?? null } : {}),
        },
        key = JSON.stringify(body);
      if (pending?.key !== key)
        pending = { key, body: { ...body, request_id: crypto.randomUUID() } };
      busy = true;
      submit.disabled = true;
      notice.textContent = "Guardando pedido…";
      try {
        const result = await request(`/api/${source}/demand-notebook`, {
          method: "POST",
          body: JSON.stringify(pending.body),
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        pending = null;
        form.reset();
        await refresh();
        notice.textContent = result?.deduplicated
          ? "Este cliente ya tiene un pedido de este tema. Se conserva un solo registro."
          : "Pedido guardado. El negocio podrá revisarlo.";
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError"))
          notice.textContent =
            (error instanceof Error && error.message) ||
            "No pudimos guardar. Reintenta con conexión.";
      } finally {
        busy = false;
        setPaused(paused);
      }
    },
    { signal: abort.signal },
  );
  reload.addEventListener("click", refresh, { signal: abort.signal });
  const ready = refresh();
  return {
    ready,
    refresh,
    setPaused,
    destroy() {
      abort.abort();
      section.remove();
    },
  };
}
