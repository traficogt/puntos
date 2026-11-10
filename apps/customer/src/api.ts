import { apiOrigin } from "./model.ts";
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
export class ApiClient {
  origin: string;
  transport: typeof fetch;
  constructor(origin: string, transport: typeof fetch = fetch) {
    this.origin = apiOrigin(origin);
    this.transport = transport;
  }
  async request<T>(
    path: string,
    {
      method = "GET",
      token,
      body,
    }: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<T> {
    if (
      !/^\/(?:(?:business|customer)(?:\/|$)|access\/(?:request-code|verify|select)$)/.test(path) ||
      path.includes("..") ||
      path.includes("?") ||
      path.includes("#")
    )
      throw new Error("Ruta inválida.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Browser fetch rejects an ApiClient instance as its receiver.
      const transport = this.transport;
      const res = await transport(this.origin + "/api/mobile" + path, {
        method,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let message = "No se pudo completar la solicitud. Intenta de nuevo.";
        if (res.status === 401)
          message =
            path === "/access/verify" || /^\/business\/[^/]+\/(?:join|login)\/verify$/.test(path)
              ? "El código no es válido o ya venció. Revisa los 6 dígitos o pide otro código."
              : path === "/access/select"
                ? "Vuelve a verificar tu teléfono para abrir tu tarjeta."
                : "Tu sesión terminó. Vuelve a ingresar.";
        if (res.status === 400)
          message = "Revisa los datos e intenta de nuevo.";
        if (res.status === 404)
          message = "No encontramos el negocio o la cuenta. Revisa tu enlace.";
        if (res.status === 429)
          message = "Espera un momento antes de volver a intentarlo.";
        if (res.status === 503)
          message =
            "El servicio no está disponible por ahora. Intenta más tarde.";
        throw new ApiError(res.status, message, String(data?.code || ""));
      }
      return data as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        0,
        "No pudimos conectar. Revisa tu conexión e intenta de nuevo.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
