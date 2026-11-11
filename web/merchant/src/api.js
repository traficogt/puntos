import {staffLoginHref} from "../../../public/staff-return-path.js";
import {trackDemoEvent} from './demo-analytics.js';
import { api as baseApi } from "/lib.js";
import { useEffect, useState } from "react";
export const isDemo = location.pathname.replace(/\/$/, "") === "/demostracion" || new URLSearchParams(location.search).get("demo") === "1";
export const sessionEvent = "pf:merchant-session-invalid";
export function stored(key) {
  if (isDemo) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
let blocked = stored("pf_staff_logout_pending") === "1";
export function blockSession() {
  blocked = true;
  window.dispatchEvent(new Event(sessionEvent));
}
export async function api(path, options = {}) {
  if (isDemo) { const result=await (await import("./demo-api.js")).demoApi(path, options); if(options.method&&options.method!=="GET")trackDemoEvent("demo_action_completed"); return result; }
  const epoch = stored("pf_staff_epoch");
  if (blocked || stored("pf_staff_logout_pending") === "1")
    throw new DOMException("Session expired", "AbortError");
  try {
    const data = await baseApi(path, { cache: "no-store", ...options });
    if (blocked || epoch !== stored("pf_staff_epoch"))
      throw new DOMException("Session changed", "AbortError");
    return data;
  } catch (error) {
    if (error.status === 401) blockSession();
    throw error;
  }
}
export async function logout() {
  if (isDemo) {
    location.assign("/negocio/");
    return;
  }
  blockSession();
  try {
    localStorage.setItem("pf_staff_logout_pending", "1");
    localStorage.removeItem("pf_staff_snapshot");
    localStorage.setItem("pf_staff_epoch", crypto.randomUUID());
  } catch {
    /* Local state is already blocked. */
  }
  try {
    await baseApi("/api/staff/logout", { method: "POST", body: "{}" });
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  try {
    localStorage.removeItem("pf_staff_logout_pending");
  } catch {
    /* No private state is stored. */
  }
  location.assign(staffLoginHref(location.pathname + location.hash));
}
window.addEventListener("storage", (event) => {
  if (isDemo) return;
  if (
    event.key === "pf_staff_epoch" ||
    (event.key === "pf_staff_logout_pending" && event.newValue === "1")
  )
    blockSession();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    blockSession();
    location.reload();
  }
});
export function useResource(path, refresh = 0) {
  const [state, setState] = useState({
    path: null,
    data: null,
    error: null,
    loading: !!path,
    refresh,
  });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ path, data: null, error: null, loading: true, refresh });
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: null, loading: false, refresh });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== "AbortError")
          setState({ path, data: null, error, loading: false, refresh });
      });
    return () => controller.abort();
  }, [path, refresh]);
  return state.path === path && state.refresh === refresh
    ? state
    : { path, data: null, error: null, loading: !!path, refresh };
}
