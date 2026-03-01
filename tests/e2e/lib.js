import { expect } from "@playwright/test";

async function browserApi(page, { method, url, data, csrf, headers }) {
  const payload = {
    method,
    url,
    data: data === undefined ? null : data,
    csrf: csrf === true,
    headers: headers && typeof headers === "object" ? headers : {}
  };

  return page.evaluate(async (p) => {
    const methodUpper = String(p.method || "GET").toUpperCase();
    const h = { ...(p.headers || {}) };

    const hasBody = !["GET", "HEAD"].includes(methodUpper);
    if (hasBody && !Object.keys(h).some((k) => k.toLowerCase() === "content-type")) {
      h["content-type"] = "application/json";
    }

    if (hasBody && p.csrf) {
      const token = document.cookie
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith("pf_csrf_readable="))
        ?.split("=")[1] || "";
      if (token) h["x-csrf-token"] = decodeURIComponent(token);
    }

    const resp = await fetch(p.url, {
      method: methodUpper,
      credentials: "include",
      headers: h,
      body: hasBody ? JSON.stringify(p.data ?? {}) : undefined
    });

    const text = await resp.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { ok: resp.ok, status: resp.status, body };
  }, payload);
}

export async function apiGet(page, url, { headers = {} } = {}) {
  return browserApi(page, { method: "GET", url, data: null, csrf: false, headers });
}

export async function apiPost(page, url, data, { csrf = true, headers = {} } = {}) {
  return browserApi(page, { method: "POST", url, data, csrf, headers });
}

export async function apiPatch(page, url, data, { csrf = true, headers = {} } = {}) {
  return browserApi(page, { method: "PATCH", url, data, csrf, headers });
}

export async function apiPut(page, url, data, { csrf = true, headers = {} } = {}) {
  return browserApi(page, { method: "PUT", url, data, csrf, headers });
}

export async function apiDelete(page, url, { csrf = true, headers = {} } = {}) {
  return browserApi(page, { method: "DELETE", url, data: null, csrf, headers });
}

export function expectOk({ ok, status, body }, hint = "") {
  const details = `status ${status}: ${JSON.stringify(body)}`;
  expect(ok, hint ? `${hint} (${details})` : `Expected ok response, got ${details}`).toBeTruthy();
}
