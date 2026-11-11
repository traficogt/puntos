function sameScope(left, right) {
  return Boolean(left?.businessId && left?.staffId && left.businessId === right?.businessId && left.staffId === right?.staffId);
}

function payloadFor(award) {
  const { txId, customerQrToken, amount_q, visits, items, meta, client_ts, offlineGrant } = award;
  return { txId, customerQrToken, amount_q, visits, items, meta, client_ts, ...(offlineGrant ? { offlineGrant } : {}) };
}

/** @param {{ store: any, api: Function, authenticate: Function, isOnline?: Function, canSend?: Function, onChange?: Function, withLock?: Function }} options */
export function createAwardQueue({ store, api, authenticate, isOnline = () => navigator.onLine, canSend = () => true, onChange = async () => {}, withLock = async (_scope, fn) => fn() }) {
  let tail = Promise.resolve();
  let syncFlight = null;
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  function exclusive(task) {
    const next = tail.then(task, task);
    tail = next.then(() => {}, () => {});
    return next;
  }
  async function storage(task) {
    try { return await task(); }
    catch { throw Object.assign(new Error("No se pudo guardar o confirmar la operación en el almacenamiento. No la registres otra vez; revisa la cola y libera espacio."), { code: "OFFLINE_STORAGE_ERROR" }); }
  }
  async function markFailed(rows, scope, error) {
    await storage(() => Promise.all(rows.map((row) => store.updateAward(row.txId, {
      status: "failed", last_error: String(error?.message || error || "No se recibió confirmación."), retry_count: Number(row.retry_count || 0) + 1
    }, scope))));
    await onChange();
  }
  function submit(payload, expectedScope) {
    return exclusive(async () => {
      if (!sameScope(expectedScope, expectedScope)) throw new Error("La sesión o la cuenta cambió. Vuelve a seleccionar el cliente.");
      return withLock(expectedScope, async () => {
        const scope = await authenticate("staff.award");
        if (!sameScope(scope, expectedScope)) throw new Error("La sesión o la cuenta cambió. Vuelve a seleccionar el cliente.");
        await storage(() => store.addAward({ ...payloadFor(payload), ...scope, status: "queued" }));
        await onChange();
        if (!isOnline() || !canSend()) return { queued: true, response: null };
        await storage(() => store.updateAward(payload.txId, { status: "syncing" }, scope));
        let response;
        try {
          response = await api("/api/staff/award", { method: "POST", body: JSON.stringify(payloadFor(payload)) });
          if (!response?.customerId) throw new Error("El servidor no confirmó la operación. Se conserva para reintentar.");
        } catch (error) {
          await markFailed([payload], scope, error);
          throw error;
        }
        await storage(() => store.deleteAward(payload.txId, scope));
        await onChange();
        return { queued: false, response };
      });
    });
  }
  function sync() {
    if (syncFlight) return syncFlight;
    syncFlight = exclusive(async () => {
      const summary = { synced: 0, attempted: 0, failed: 0 };
      if (!isOnline()) return summary;
      const scope = await authenticate("staff.sync");
      if (!scope) return summary;
      return withLock(scope, async () => {
        const queued = await storage(() => store.listAwards({ ...scope, statuses: ["queued", "failed", "syncing"] }));
        for (let offset = 0; offset < queued.length; offset += 100) {
          if (!isOnline() || !sameScope(scope, await authenticate("staff.sync"))) break;
          const batch = queued.slice(offset, offset + 100);
          await storage(() => Promise.all(batch.map((row) => store.updateAward(row.txId, { status: "syncing", last_error: "" }, scope))));
          await onChange();
          let result;
          try {
            result = await api("/api/staff/sync", { method: "POST", body: JSON.stringify({ awards: batch.map(payloadFor) }) });
            if (!Array.isArray(result?.results)) throw new Error("El servidor no confirmó las operaciones. Se conservan para reintentar.");
          } catch (error) {
            await markFailed(batch, scope, error);
            throw error;
          }
          summary.attempted += batch.length;
          for (const row of batch) {
            const matches = result.results.filter((ack) => ack.txId === row.txId);
            if (matches.length === 1 && matches[0].ok === true) {
              await storage(() => store.deleteAward(row.txId, scope));
              summary.synced += 1;
            } else {
              await markFailed([row], scope, matches[0]?.error || "El servidor no confirmó esta operación. Se conserva para reintentar.");
              summary.failed += 1;
            }
          }
          await onChange();
        }
        return summary;
      });
    }).finally(() => { syncFlight = null; });
    return syncFlight;
  }
  return { submit, sync };
}
