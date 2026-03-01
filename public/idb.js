const DB_NAME = "pf";
const DB_VER = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("awards")) {
        db.createObjectStore("awards", { keyPath: "txId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("awards", mode);
    const store = tx.objectStore("awards");
    const out = fn(store);
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addAward(award) {
  return withStore("readwrite", (store) => store.put(award));
}

export async function listAwards() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("awards", "readonly");
    const store = tx.objectStore("awards");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAward(txId) {
  return withStore("readwrite", (store) => store.delete(txId));
}

export async function clearAwards() {
  return withStore("readwrite", (store) => store.clear());
}
