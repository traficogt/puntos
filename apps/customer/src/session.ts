import { ApiClient, ApiError } from "./api.ts";
import { matches, validSession } from "./model.ts";
import type { Session, Snapshot, Qr } from "./model.ts";
export type Storage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};
export type State = {
  session: Session | null;
  snapshot: Snapshot | null;
  syncedAt: number | null;
  offline: boolean;
  fresh: boolean;
  loading: boolean;
  error: string | null;
  qr: Qr | null;
  demo: boolean;
};
const empty: State = {
  session: null,
  snapshot: null,
  syncedAt: null,
  offline: false,
  fresh: false,
  loading: false,
  error: null,
  qr: null,
  demo: false,
};
export class SessionController {
  api: ApiClient;
  secure: Storage;
  cache: Storage;
  private state: State = { ...empty };
  private generation = 0;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private refreshing = false;
  constructor(api: ApiClient, secure: Storage, cache: Storage) {
    this.api = api;
    this.secure = secure;
    this.cache = cache;
  }
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private write(fn: () => Promise<unknown>) {
    const task = this.writes.catch(() => {}).then(fn);
    this.writes = task;
    return task;
  }
  async restore() {
    const gen = this.generation;
    this.set({ loading: true });
    try {
      const raw = await this.secure.get("pf.session");
      if (gen !== this.generation) return;
      const session = raw ? JSON.parse(raw) : null;
      if (!validSession(session)) {
        await this.clear();
        return;
      }
      const cached = await this.cache.get("pf.snapshot");
      if (gen !== this.generation) return;
      let snapshot: Snapshot | null = null;
      let syncedAt: number | null = null;
      let discardCache = false;
      if (cached) {
        try {
          const data = JSON.parse(cached);
          if (
            matches(data.snapshot, session) &&
            Number.isFinite(data.syncedAt) &&
            data.syncedAt <= Date.now() &&
            Date.now() - data.syncedAt < 8 * 60 * 60 * 1000
          ) {
            snapshot = data.snapshot;
            syncedAt = data.syncedAt;
          } else discardCache = true;
        } catch {
          discardCache = true;
        }
      }
      if (discardCache)
        await this.write(() =>
          gen === this.generation
            ? this.cache.remove("pf.snapshot")
            : Promise.resolve(),
        );
      if (gen !== this.generation) return;
      if (!validSession(session)) {
        await this.clear();
        return;
      }
      // Expose the identity only after hydration; connectivity listeners cannot
      // publish a fresh response that an older cache read later overwrites.
      this.set({ session, snapshot, syncedAt, fresh: false });
      await this.refresh();
    } catch {
      if (gen === this.generation) {
        const clearedGen = this.generation + 1;
        await this.clear().catch(() => {});
        if (clearedGen === this.generation && !this.state.error)
          this.set({
            error: "No se pudo recuperar la sesión. Vuelve a ingresar.",
          });
      }
    } finally {
      if (gen === this.generation && !this.refreshing)
        this.set({ loading: false });
    }
  }
  async activate(
    session: Session,
    { isCurrent = () => true }: { isCurrent?: () => boolean } = {},
  ) {
    if (!isCurrent()) return;
    if (!validSession(session)) throw new Error("La sesión no es válida.");
    const gen = this.generation + 1;
    const current = () => gen === this.generation && isCurrent();
    await this.clear();
    if (!current()) return;
    await this.write(async () => {
      if (!current()) return;
      await this.secure.set("pf.session", JSON.stringify(session));
      // Cancellation can arrive while the native secure-storage call is pending.
      // Cleanup runs in this write before another account's queued activation.
      if (!current()) await this.secure.remove("pf.session");
    });
    if (current()) this.set({ session });
    else if (gen === this.generation)
      await this.write(() =>
        gen === this.generation
          ? this.secure.remove("pf.session")
          : Promise.resolve(),
      );
  }
  async clear() {
    const gen = ++this.generation;
    this.refreshing = false;
    this.state = { ...empty, offline: this.state.offline };
    this.listeners.forEach((fn) => fn());
    try {
      await this.write(async () => {
        const results = await Promise.allSettled([
          this.secure.remove("pf.session"),
          this.cache.remove("pf.snapshot"),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      });
    } catch (error) {
      if (gen === this.generation)
        this.set({
          error:
            "No se pudieron borrar todos los datos locales al cerrar la sesión. Intenta de nuevo.",
        });
      throw error;
    }
  }
  async signOut() {
    const token = this.state.session?.token;
    await this.clear().catch(() => {});
    if (token)
      await this.api
        .request("/customer/logout", { method: "POST", token })
        .catch(() => {});
  }
  private isSessionCurrent(gen: number, token: string) {
    return gen === this.generation && this.state.session?.token === token;
  }
  private async invalidate(gen: number, token: string) {
    if (!this.isSessionCurrent(gen, token)) return;
    const clearedGen = this.generation + 1;
    await this.clear().catch(() => {});
    if (clearedGen === this.generation && !this.state.error)
      this.set({ error: "Tu sesión terminó. Vuelve a ingresar." });
  }
  async authenticated<T>(
    path: string,
    options: { method?: string; body?: unknown } = {},
    {
      invalidateSnapshotOnFailure = true,
    }: { invalidateSnapshotOnFailure?: boolean } = {},
  ): Promise<T> {
    const session = this.state.session;
    const gen = this.generation;
    if (!session || this.state.demo)
      throw new Error("Ingresa a tu cuenta para continuar.");
    const token = session.token;
    if (!validSession(session)) {
      await this.invalidate(gen, token);
      throw new ApiError(401, "Tu sesión terminó. Vuelve a ingresar.");
    }
    if (this.state.offline) {
      this.set({ fresh: false });
      throw new ApiError(0, "Conéctate para completar esta solicitud.");
    }
    try {
      const result = await this.api.request<T>(path, { ...options, token });
      if (!this.isSessionCurrent(gen, token))
        throw new Error("La cuenta cambió. Intenta de nuevo.");
      if (!validSession(session)) {
        await this.invalidate(gen, token);
        throw new ApiError(401, "Tu sesión terminó. Vuelve a ingresar.");
      }
      return result;
    } catch (error) {
      if (!this.isSessionCurrent(gen, token)) throw error;
      if (invalidateSnapshotOnFailure) this.set({ fresh: false });
      if (
        error instanceof ApiError &&
        (error.status === 401 ||
          (error.status === 404 && error.code === "CUSTOMER_NOT_FOUND"))
      )
        await this.invalidate(gen, token);
      throw error;
    }
  }
  async refresh() {
    const session = this.state.session;
    if (
      !session ||
      this.state.demo ||
      (this.refreshing && validSession(session))
    )
      return;
    const gen = this.generation;
    this.refreshing = true;
    this.set({ loading: true, error: null, fresh: false });
    try {
      const snapshot = await this.authenticated<Snapshot>("/customer");
      if (!this.isSessionCurrent(gen, session.token)) return;
      if (!matches(snapshot, session))
        throw new Error("La respuesta no coincide con tu cuenta.");
      const syncedAt = Date.now();
      this.set({ snapshot, syncedAt, fresh: !this.state.offline });
      // Keep contact details and credentials out of ordinary device storage.
      const cached = {
        ...snapshot,
        customer: {
          id: snapshot.customer.id,
          points: snapshot.customer.points,
          pending_points: snapshot.customer.pending_points,
          lifetime_points: snapshot.customer.lifetime_points,
        },
        transactions: snapshot.transactions.slice(0, 25),
        redemptions: [],
      };
      await this.write(() =>
        gen === this.generation
          ? this.cache.set(
              "pf.snapshot",
              JSON.stringify({ snapshot: cached, syncedAt }),
            )
          : Promise.resolve(),
      );
    } catch (e) {
      if (gen !== this.generation) return;
      this.set({
        fresh: false,
        error: e instanceof Error ? e.message : "No se pudo actualizar.",
      });
    } finally {
      if (gen === this.generation) {
        this.refreshing = false;
        this.set({ loading: false });
      }
    }
  }
  async issueQr() {
    const session = this.state.session;
    if (!session || this.state.demo)
      throw new Error("Ingresa a tu cuenta para mostrar tu QR.");
    const gen = this.generation;
    const qr = await this.authenticated<Qr>("/customer/qr", {
      method: "POST",
    });
    if (this.isSessionCurrent(gen, session.token)) this.set({ qr });
  }
  setOffline(offline: boolean) {
    this.set({ offline, fresh: false, ...(offline ? { qr: null } : {}) });
  }
  async preview(snapshot: Snapshot) {
    await this.clear();
    this.set({ snapshot, demo: true, syncedAt: null });
  }
  async deleteAccount() {
    const token = this.state.session?.token;
    const gen = this.generation;
    await this.authenticated("/customer", {
      method: "DELETE",
      body: { confirm: true },
    });
    if (token && this.isSessionCurrent(gen, token)) await this.clear();
  }
}
