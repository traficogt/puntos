const DB_NAME = "pf";
const DB_VER = 3;
const AWARDS_STORE = "awards";
const CUSTOMER_CACHE_STORE = "customerCache";
const CACHE_IDENTITY_KEY = "__identity__";

function matchesScope(row, scope, identityKey = "staffId") {
  return Boolean(scope?.businessId && scope?.[identityKey] && row?.businessId === scope.businessId && row?.[identityKey] === scope[identityKey]);
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;

      let awardsStore;
      if (!db.objectStoreNames.contains(AWARDS_STORE)) {
        awardsStore = db.createObjectStore(AWARDS_STORE, { keyPath: "txId" });
      } else {
        awardsStore = req.transaction.objectStore(AWARDS_STORE);
      }
      if (!awardsStore.indexNames.contains("by_status")) {
        awardsStore.createIndex("by_status", "status", { unique: false });
      }
      if (!awardsStore.indexNames.contains("by_updated_at")) {
        awardsStore.createIndex("by_updated_at", "updated_at", { unique: false });
      }

      if (!db.objectStoreNames.contains(CUSTOMER_CACHE_STORE)) {
        db.createObjectStore(CUSTOMER_CACHE_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Cierra otras pestañas de Puntos para actualizar el almacenamiento."));
  });
}

async function withStore(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(storeName, mode); }
    catch (error) { db.close(); reject(error); return; }
    let out, operationError;
    tx.oncomplete = () => { db.close(); resolve(out); };
    tx.onerror = tx.onabort = () => { db.close(); reject(operationError || tx.error || new Error("No se pudo guardar la operación.")); };
    try {
      Promise.resolve(fn(tx.objectStore(storeName), tx)).then((result) => { out = result; }, (error) => {
        operationError = error;
        try { tx.abort(); } catch { db.close(); reject(error); }
      });
    } catch (error) {
      operationError = error;
      tx.abort();
    }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAward(award) {
  const createdAt = award.created_at || award.client_ts || nowIso();
  return {
    ...award,
    created_at: createdAt,
    updated_at: nowIso(),
    status: award.businessId && award.staffId ? (award.status || "queued") : "quarantined",
    retry_count: Number(award.retry_count || 0),
    last_error: String(award.last_error || "")
  };
}

function getAllFromRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

function getOneFromRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function addAward(award) {
  const queuedAward = normalizeAward(award);
  return withStore(AWARDS_STORE, "readwrite", (store) => store.add(queuedAward));
}

export async function updateAward(txId, patch, scope) {
  return withStore(AWARDS_STORE, "readwrite", async (store) => {
    const current = await getOneFromRequest(store.get(txId));
    if (!matchesScope(current, scope)) return null;
    const next = {
      ...current,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.retry_count !== undefined ? { retry_count: patch.retry_count } : {}),
      ...(patch.last_error !== undefined ? { last_error: patch.last_error } : {}),
      txId,
      updated_at: nowIso()
    };
    store.put(next);
    return next;
  });
}

export async function listAwards(options = {}) {
  const statuses = Array.isArray(options.statuses) && options.statuses.length
    ? new Set(options.statuses)
    : null;

  const rows = await withStore(AWARDS_STORE, "readonly", async (store) => getAllFromRequest(store.getAll()));
  return rows
    .filter((row) => matchesScope(row, options) && row.status !== "quarantined" && (!statuses || statuses.has(row.status || "queued")))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

export async function getAwardQueueStats(scope) {
  const awards = await listAwards(scope);
  const all = await withStore(AWARDS_STORE, "readonly", (store) => getAllFromRequest(store.getAll()));
  const stats = {
    total: awards.length,
    queued: 0,
    syncing: 0,
    failed: 0,
    quarantined: all.filter((row) => !row.businessId || !row.staffId || row.status === "quarantined").length,
    lastQueuedAt: "",
    lastError: ""
  };

  for (const award of awards) {
    if (award.status === "syncing") stats.syncing += 1;
    else if (award.status === "failed") stats.failed += 1;
    else stats.queued += 1;

    if (!stats.lastQueuedAt || String(award.updated_at || "") > stats.lastQueuedAt) {
      stats.lastQueuedAt = String(award.updated_at || "");
    }
    if (award.last_error) stats.lastError = String(award.last_error);
  }

  return stats;
}

export async function requeueSyncingAwards(scope) {
  const syncingAwards = await listAwards({ ...scope, statuses: ["syncing"] });
  await Promise.all(syncingAwards.map((award) => updateAward(award.txId, { status: "queued" }, scope)));
}

export async function deleteAward(txId, scope) {
  return withStore(AWARDS_STORE, "readwrite", async (store) => {
    const current = await getOneFromRequest(store.get(txId));
    if (matchesScope(current, scope)) store.delete(txId);
  });
}

export async function clearAwards() {
  return withStore(AWARDS_STORE, "readwrite", (store) => store.clear());
}

export async function putCustomerCache(key, data, scope) {
  if (!scope?.businessId || !scope?.customerId || key === CACHE_IDENTITY_KEY) throw new Error("Falta la identidad del cliente para guardar datos.");
  const record = {
    key,
    data,
    ...scope,
    updatedAt: nowIso()
  };
  return withStore(CUSTOMER_CACHE_STORE, "readwrite", async (store) => {
    const active = await getOneFromRequest(store.get(CACHE_IDENTITY_KEY));
    if (key === "me") {
      if (data?.business?.id !== scope.businessId || data?.customer?.id !== scope.customerId) throw new Error("La identidad de los datos no coincide con el cliente.");
      if (!matchesScope(active, scope, "customerId")) store.clear();
      store.put({ key: CACHE_IDENTITY_KEY, ...scope });
    } else if (!matchesScope(active, scope, "customerId")) {
      throw new Error("La sesión del cliente cambió. Se descartaron los datos anteriores.");
    }
    store.put(record);
  });
}

export async function getCustomerCacheSnapshot(scope) {
  const rows = await withStore(CUSTOMER_CACHE_STORE, "readonly", async (store) => getAllFromRequest(store.getAll()));
  const sections = {};
  const updatedAt = {};
  let latestUpdatedAt = "";

  const active = rows.find((row) => row.key === CACHE_IDENTITY_KEY);
  for (const row of rows) {
    if (row.key === CACHE_IDENTITY_KEY || !matchesScope(active, scope, "customerId") || !matchesScope(row, scope, "customerId")) continue;
    sections[row.key] = row.data;
    updatedAt[row.key] = row.updatedAt;
    if (!latestUpdatedAt || String(row.updatedAt || "") > latestUpdatedAt) {
      latestUpdatedAt = String(row.updatedAt || "");
    }
  }

  return {
    sections,
    updatedAt,
    latestUpdatedAt
  };
}

export async function clearCustomerCache() {
  return withStore(CUSTOMER_CACHE_STORE, "readwrite", (store) => store.clear());
}
