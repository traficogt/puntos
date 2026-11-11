import type { Session } from "./model.ts";
import type { Storage } from "./session.ts";
export type PushPermission = "granted" | "denied" | "undetermined";
export type Installation = {
  installationId: string;
  installationSecret: string;
};
export type PushNative = {
  supported: boolean;
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  token(): Promise<string>;
  clear(): Promise<void>;
  createInstallation(): Promise<Installation>;
  hash(value: string): Promise<string>;
};
type Owner = { customerId: string; businessId: string; sessionHash: string };
type Registration = Installation & {
  version: 1;
  owner: Owner | null;
  pendingRevoke: boolean;
};
export type PushState = {
  supported: boolean;
  enabled: boolean;
  consented: boolean;
  busy: boolean;
  permission: PushPermission;
  available: boolean | null;
  pendingRevoke: boolean;
  error: string | null;
  message: string | null;
};
type Request = (
  path: string,
  options?: { method?: string; body?: unknown; token?: string },
) => Promise<unknown>;
const key = "pf.push.installation.v1";
const sameOwner = (a: Owner | null, b: Owner | null) =>
  !!a &&
  !!b &&
  a.customerId === b.customerId &&
  a.businessId === b.businessId &&
  a.sessionHash === b.sessionHash;
function readRegistration(raw: string): Registration {
  const r = JSON.parse(raw);
  if (
    r?.version !== 1 ||
    !/^[a-f0-9-]{36}$/i.test(r.installationId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(r.installationSecret) ||
    typeof r.pendingRevoke !== "boolean" ||
    (r.owner !== null &&
      (!r.owner ||
        !["customerId", "businessId", "sessionHash"].every(
          (k) => typeof r.owner[k] === "string" && r.owner[k],
        )))
  )
    throw new Error("Invalid push storage");
  return r;
}
// Hermes does not require browser btoa/Buffer globals. Encode exactly 32 random
// bytes into the server's canonical, unpadded 43-character device credential.
export function encodeInstallationSecret(bytes: Uint8Array) {
  if (bytes.length !== 32)
    throw new Error("Expected a 32-byte installation secret");
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = 0,
    bits = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      result += alphabet[(value >>> bits) & 63];
    }
  }
  if (bits) result += alphabet[(value << (6 - bits)) & 63];
  return result;
}
export function notificationRoute(data: unknown, session: Session | null) {
  if (!session || !data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (
    d.customerId !== session.customerId ||
    d.businessId !== session.businessId
  )
    return null;
  return d.kind === "card"
    ? "/(tabs)/card"
    : d.kind === "rewards"
      ? "/(tabs)/rewards"
      : null;
}
/** A single serial queue owns all persisted consent and server mutations. Session
 * changes invalidate pending work immediately, including native permission prompts. */
export class PushController {
  private deps: { native: PushNative; storage: Storage; request: Request };
  private state: PushState;
  private session: Session | null = null;
  private offline = false;
  private generation = 0;
  private lastRegistration: { generation: number; token: string } | null = null;
  private loaded = false;
  private initialized = false;
  private record: Registration | null = null;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(deps: {
    native: PushNative;
    storage: Storage;
    request: Request;
  }) {
    this.deps = deps;
    this.state = {
      supported: deps.native.supported,
      enabled: false,
      consented: false,
      busy: false,
      permission: "undetermined",
      available: null,
      pendingRevoke: false,
      error: null,
      message: null,
    };
  }
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(patch: Partial<PushState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private current(gen: number) {
    return gen === this.generation;
  }
  private run(task: (gen: number) => Promise<void>) {
    if (!this.deps.native.supported) return Promise.resolve();
    const gen = this.generation;
    const job = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.current(gen)) return;
        this.set({ busy: true, error: null, message: null });
        try {
          if (!this.loaded) {
            const raw = await this.deps.storage.get(key);
            this.record = raw ? readRegistration(raw) : null;
            this.loaded = true;
          }
          if (this.current(gen)) await task(gen);
        } catch {
          if (this.current(gen))
            this.set({
              error:
                "No pudimos guardar el cambio de notificaciones. Revisa tu conexión e intenta de nuevo.",
            });
        } finally {
          if (this.current(gen)) this.set({ busy: false });
        }
      });
    this.queue = job;
    return job;
  }
  private async save() {
    if (this.record)
      await this.deps.storage.set(key, JSON.stringify(this.record));
    this.set({ pendingRevoke: !!this.record?.pendingRevoke });
  }
  private async owner(session: Session): Promise<Owner> {
    return {
      customerId: session.customerId,
      businessId: session.businessId,
      sessionHash: await this.deps.native.hash(session.token),
    };
  }
  private credentials() {
    if (!this.record) throw new Error("No registration");
    return {
      installationId: this.record.installationId,
      installationSecret: this.record.installationSecret,
    };
  }
  private async revoke() {
    if (!this.record) return;
    await this.deps.native.clear().catch(() => {});
    this.record = { ...this.record, owner: null, pendingRevoke: true };
    this.set({ enabled: false, consented: false, pendingRevoke: true });
    // Persist before network: an offline logout can be completed without a bearer.
    await this.save();
    if (this.offline) return;
    await this.deps.request("/customer/push-device/revoke", {
      method: "POST",
      body: this.credentials(),
    });
    this.record = { ...this.record, pendingRevoke: false };
    await this.save();
  }
  sync(session: Session | null, offline: boolean) {
    const changed =
      this.session?.token !== session?.token ||
      this.session?.customerId !== session?.customerId ||
      this.session?.businessId !== session?.businessId;
    this.session = session;
    this.offline = offline;
    if (changed) {
      this.generation++;
      this.set({
        enabled: false,
        consented: false,
        busy: false,
        available: null,
        error: null,
        message: null,
      });
      if (this.initialized) void this.deps.native.clear().catch(() => {});
    }
    this.initialized = true;
    return this.reconcile();
  }
  reconcile() {
    return this.run(async (gen) => {
      const session = this.session;
      const owner = session ? await this.owner(session) : null;
      if (!this.current(gen)) return;
      if (
        this.record?.pendingRevoke ||
        (this.record?.owner && !sameOwner(this.record.owner, owner))
      )
        await this.revoke();
      if (!this.current(gen)) return;
      this.set({ consented: sameOwner(this.record?.owner ?? null, owner) });
      if (!session) return;
      const permission = await this.deps.native.permission();
      if (!this.current(gen)) return;
      this.set({ permission });
      if (this.record?.owner && permission !== "granted") await this.revoke();
      if (!this.current(gen)) return;
      if (this.offline) return;
      const status = (await this.deps.request("/customer/push-status", {
        token: session.token,
      })) as { available: boolean };
      if (!this.current(gen)) return;
      this.set({ available: status.available === true });
      if (status.available && sameOwner(this.record?.owner ?? null, owner))
        await this.register(gen, session, owner!);
    });
  }
  enable() {
    return this.run(async (gen) => {
      const session = this.session;
      if (!session || this.offline || this.state.available !== true) return;
      const owner = await this.owner(session);
      if (!this.current(gen)) return;
      if (
        this.record?.pendingRevoke ||
        (this.record?.owner && !sameOwner(this.record.owner, owner))
      )
        await this.revoke();
      if (!this.current(gen)) return;
      let permission = await this.deps.native.permission();
      if (!this.current(gen)) return;
      if (permission === "undetermined")
        permission = await this.deps.native.requestPermission();
      if (!this.current(gen)) return;
      this.set({ permission });
      if (permission !== "granted") return;
      if (!this.record) {
        const installation = await this.deps.native.createInstallation();
        if (!this.current(gen)) return;
        this.record = {
          ...installation,
          version: 1,
          owner: null,
          pendingRevoke: false,
        };
        await this.save();
      }
      if (!this.current(gen)) return;
      await this.register(gen, session, owner);
    });
  }
  private async register(
    gen: number,
    session: Session,
    owner: Owner,
    rotatedToken?: string,
  ) {
    const token = rotatedToken ?? (await this.deps.native.token());
    if (!this.current(gen) || this.offline || !this.record) return;
    // Save intent first so a crash or ambiguous network result can be revoked.
    this.record = { ...this.record, owner, pendingRevoke: false };
    this.set({ consented: true });
    await this.save();
    if (!this.current(gen)) return;
    try {
      const result = (await this.deps.request("/customer/push-device", {
        method: "PUT",
        token: session.token,
        body: { ...this.credentials(), token, platform: "ios" },
      })) as { enabled: boolean };
      if (this.current(gen)) {
        if (result.enabled) this.lastRegistration = { generation: gen, token };
        this.set({ enabled: result.enabled === true });
      }
    } finally {
      // The PUT may have reached PF even if the response was lost during logout.
      if (!this.current(gen)) await this.revoke();
    }
  }
  tokenChanged(token: string) {
    return this.run(async (gen) => {
      const session = this.session;
      if (
        !session ||
        this.offline ||
        !this.record?.owner ||
        !/^[a-f0-9]{32,512}$/i.test(token)
      )
        return;
      const permission = await this.deps.native.permission();
      if (!this.current(gen)) return;
      this.set({ permission });
      if (permission !== "granted") {
        await this.revoke();
        return;
      }
      if (
        this.lastRegistration?.generation === gen &&
        this.lastRegistration.token === token
      )
        return;
      const owner = await this.owner(session);
      if (this.current(gen) && sameOwner(this.record.owner, owner))
        await this.register(gen, session, owner, token);
    });
  }
  disable() {
    this.generation++;
    this.set({ enabled: false, consented: false, busy: false, message: null });
    void this.deps.native.clear().catch(() => {});
    return this.run(async () => {
      await this.revoke();
    });
  }
  test() {
    return this.run(async (gen) => {
      const session = this.session;
      if (
        !session ||
        this.offline ||
        !this.state.enabled ||
        !this.record?.owner
      )
        return;
      await this.deps.request("/customer/push-device/test", {
        method: "POST",
        token: session.token,
        body: this.credentials(),
      });
      if (this.current(gen))
        this.set({
          message:
            "Prueba enviada a Apple. Revisa las notificaciones de tu iPhone.",
        });
    });
  }
}
