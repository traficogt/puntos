const DB_NAME = "pf";
const DB_VER = 2;
const AWARDS_STORE = "awards";
const CUSTOMER_CACHE_STORE = "customerCache";

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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const out = fn(store, tx);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
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
    status: award.status || "queued",
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
  return withStore(AWARDS_STORE, "readwrite", (store) => store.put(queuedAward));
}

export async function updateAward(txId, patch) {
  return withStore(AWARDS_STORE, "readwrite", async (store) => {
    const current = await getOneFromRequest(store.get(txId));
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
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
    .filter((row) => !statuses || statuses.has(row.status))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

export async function getAwardQueueStats() {
  const awards = await listAwards();
  const stats = {
    total: awards.length,
    queued: 0,
    syncing: 0,
    failed: 0,
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

export async function requeueSyncingAwards() {
  const syncingAwards = await listAwards({ statuses: ["syncing"] });
  await Promise.all(syncingAwards.map((award) => updateAward(award.txId, { status: "queued" })));
}

export async function deleteAward(txId) {
  return withStore(AWARDS_STORE, "readwrite", (store) => store.delete(txId));
}

export async function clearAwards() {
  return withStore(AWARDS_STORE, "readwrite", (store) => store.clear());
}

export async function putCustomerCache(key, data) {
  const record = {
    key,
    data,
    updatedAt: nowIso()
  };
  return withStore(CUSTOMER_CACHE_STORE, "readwrite", (store) => store.put(record));
}

export async function getCustomerCacheSnapshot() {
  const rows = await withStore(CUSTOMER_CACHE_STORE, "readonly", async (store) => getAllFromRequest(store.getAll()));
  const sections = {};
  const updatedAt = {};
  let latestUpdatedAt = "";

  for (const row of rows) {
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
