const panels = new WeakMap();
const OFFLINE_MESSAGE = "Tu tarjeta guardada sigue disponible sin conexión. El saldo se actualiza al recuperar la conexión.";

function hidden(element, value) {
  if (!element) return;
  element.hidden = value;
  element.classList.toggle("is-hidden", value);
}

function isAuthError(error) {
  return error?.status === 401 || String(error?.code || "").startsWith("AUTH_") || error?.code === "CUSTOMER_NOT_FOUND";
}

function safeDestination(provider, url) {
  if (provider === "apple") return url === "/api/customer/wallet/apple/download";
  return typeof url === "string" && /^https:\/\/pay\.google\.com\/gp\/v\/save\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(url);
}

/** Native issuance URLs stay in this request's memory and never enter browser storage. */
export async function renderNativeWallet({ api, $, identity, isCurrent = () => true, navigate = (url) => location.assign(url), isOnline = () => navigator.onLine }, isLive) {
  const root = $("#billeteras");
  if (!root || !isCurrent()) return;
  const owner = `${identity.businessId}:${identity.customerId}`;
  const apple = $("#btnAppleWallet");
  const google = $("#btnGoogleWallet");
  const revoke = $("#btnRevokeWallet");
  const confirm = $("#btnConfirmRevokeWallet");
  const cancel = $("#btnCancelRevokeWallet");
  const confirmation = $("#nativeWalletConfirm");
  const status = $("#nativeWalletStatus");
  const previous = panels.get(root);
  const controls = [apple, google, revoke, confirm, cancel];
  const setDisabled = (value) => controls.forEach(control => { if (control) control.disabled = value; });
  if (isLive && previous?.ready && previous.owner === owner && root.dataset.nativeWalletOwner === owner
      && !root.hidden && (previous.busy || !confirmation.hidden)) {
    previous.isCurrent = isCurrent;
    return;
  }
  root.dataset.nativeWalletOwner = owner;

  if (!isLive) {
    if (previous?.owner === owner && previous.ready) {
      previous.live = false;
      previous.isCurrent = isCurrent;
      status.textContent = OFFLINE_MESSAGE;
      setDisabled(true);
      hidden(confirmation, true);
    } else hidden(root, true);
    return;
  }

  const state = { owner, isCurrent, live: true, busy: false, ready: false };
  panels.set(root, state);
  const current = () => panels.get(root) === state && root.dataset.nativeWalletOwner === owner && state.isCurrent();
  const canAct = () => current() && !root.hidden && state.live && isOnline() && !state.busy;
  if (!previous?.ready || previous.owner !== owner) hidden(root, true);
  setDisabled(true);
  hidden(confirmation, true);
  status.textContent = "";

  if (!previous) {
    globalThis.addEventListener?.("offline", () => {
      const active = panels.get(root);
      if (!active?.ready || !active.isCurrent() || root.hidden) return;
      active.live = false;
      setDisabled(true);
      hidden(confirmation, true);
      status.textContent = OFFLINE_MESSAGE;
    });
  }

  try {
    const data = await api("/api/customer/wallet");
    if (!current()) return;
    const available = data?.providers || {};
    const canIssue = available.apple === true || available.google === true;
    const hasPasses = Array.isArray(data?.passes) && data.passes.length > 0;
    state.ready = canIssue || hasPasses;
    hidden(root, !state.ready);
    if (!state.ready) return;
    hidden(apple, available.apple !== true);
    hidden(google, available.google !== true);
    hidden($("#nativeWalletActions"), !canIssue);
    const description = $("#nativeWalletDescription");
    if (description) description.textContent = canIssue
      ? "Guárdala en tu teléfono para mostrarla en caja. El saldo se actualiza con conexión."
      : "Tienes tarjetas guardadas. Puedes desactivarlas; guardar una nueva no está disponible por ahora.";
    hidden(revoke, !hasPasses);
    setDisabled(!isOnline());
    if (!isOnline()) status.textContent = OFFLINE_MESSAGE;
  } catch (error) {
    if (!current()) return;
    hidden(root, true);
    if (isAuthError(error)) throw error;
    return;
  }

  async function mutate(provider) {
    if (!canAct()) return;
    state.busy = true;
    setDisabled(true);
    root.setAttribute("aria-busy", "true");
    status.textContent = provider === "revoke" ? "Desactivando tarjetas…" : "Preparando tu tarjeta…";
    try {
      const result = await api(`/api/customer/wallet/${provider}`, { method: "POST", body: "{}" });
      if (!current() || root.hidden) return;
      if (provider === "revoke") {
        if (result?.ok !== true) throw new Error("Invalid response");
        hidden(revoke, true);
        hidden(confirmation, true);
        status.textContent = "Tarjetas desactivadas. Puedes guardar una nueva cuando quieras.";
        (apple.hidden ? google : apple)?.focus();
      } else {
        if (!safeDestination(provider, result?.url)) throw new Error("Invalid destination");
        if (!state.live || !isOnline()) { status.textContent = OFFLINE_MESSAGE; return; }
        hidden(revoke, false);
        status.textContent = "Continúa en tu billetera para guardar la tarjeta.";
        navigate(result.url);
      }
    } catch (error) {
      if (!current() || root.hidden) return;
      status.textContent = isAuthError(error)
        ? "Tu sesión venció. Vuelve a entrar desde el acceso del negocio."
        : "No pudimos completar la solicitud. Revisa tu conexión e inténtalo de nuevo.";
    } finally {
      state.busy = false;
      if (current()) {
        root.setAttribute("aria-busy", "false");
        setDisabled(!state.live || !isOnline());
      }
    }
  }

  apple.onclick = () => mutate("apple");
  google.onclick = () => mutate("google");
  revoke.onclick = () => {
    if (!canAct()) return;
    hidden(confirmation, false);
    confirm.focus();
  };
  cancel.onclick = () => { hidden(confirmation, true); revoke.focus(); };
  confirm.onclick = () => confirmation.hidden ? undefined : mutate("revoke");
}
