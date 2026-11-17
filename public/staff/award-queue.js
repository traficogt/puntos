function sameScope(left, right) {
  return Boolean(left?.businessId && left?.staffId && left.businessId === right?.businessId && left.staffId === right?.staffId);
}

function payloadFor(award) {
  const { txId, customerQrToken, amount_q, visits, items, meta, client_ts, offlineGrant } = award;
  return { txId, customerQrToken, amount_q, visits, items, meta, client_ts, ...(offlineGrant ? { offlineGrant } : {}) };
}

// Statuses the queue sends automatically. Every other stored status needs a
// visible cashier decision: "held" (also legacy "failed", whose outcome the
// cashier may already have been told) or "rejected" by the server.
export const RETRY_STATUSES = ["queued", "syncing"];
export const DECISION_STATUSES = ["held", "failed"];
export const DISCARDABLE_STATUSES = ["held", "failed", "rejected"];
const TRANSIENT_HTTP = new Set([408, 425, 429]);

/**
 * Classifies a failed award send.
 * - "retry": no response, unconfirmed body, timeouts/rate limits or any 5xx.
 *   A 5xx can follow a committed award (hooks run after COMMIT); retrying the
 *   same txId is idempotent, so keeping it can never credit twice.
 * - "held": the session expired (401). Never replayed without the cashier.
 * - "rejected": any other 4xx. The server refused it; it is never resent.
 * @param {any} error
 * @returns {"retry" | "held" | "rejected"}
 */
export function classifyAwardFailure(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (!Number.isInteger(status) || status < 400 || status >= 500 || TRANSIENT_HTTP.has(status)) return "retry";
  return status === 401 ? "held" : "rejected";
}

const STORED_STATUS = { retry: "queued", held: "held", rejected: "rejected" };

function failureMessage(error, outcome) {
  const reason = String(error?.message || error || "No se recibió confirmación").replace(/[.\s]+$/u, "");
  if (outcome === "held") return `${reason}. La sesión no autorizó el envío: inicia sesión y elige Reintentar o Descartar.`;
  if (outcome === "rejected") return `Rechazada por el servidor: ${reason}. No se reintentará.`;
  return `${reason}. Pendiente: se reintentará automáticamente; no la registres otra vez.`;
}

function withOutcome(error, outcome) {
  const failure = error instanceof Error ? error : new Error(String(error || "No se recibió confirmación."));
  try { Object.assign(failure, { awardOutcome: outcome }); } catch { /* Frozen errors keep their original shape. */ }
  return failure;
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
  async function markOutcome(rows, scope, error, outcome) {
    await storage(() => Promise.all(rows.map((row) => store.updateAward(row.txId, {
      status: STORED_STATUS[outcome], last_error: failureMessage(error, outcome), retry_count: Number(row.retry_count || 0) + 1
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
          const outcome = classifyAwardFailure(error);
          await markOutcome([payload], scope, error, outcome);
          throw withOutcome(error, outcome);
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
      const summary = { synced: 0, attempted: 0, failed: 0, rejected: 0, held: 0 };
      if (!isOnline()) return summary;
      const scope = await authenticate("staff.sync");
      if (!scope) return summary;
      return withLock(scope, async () => {
        const queued = await storage(() => store.listAwards({ ...scope, statuses: RETRY_STATUSES }));
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
            // A whole-batch refusal cannot say which sale caused it: hold every
            // row for an explicit decision instead of replaying or dropping it.
            const outcome = classifyAwardFailure(error) === "retry" ? "retry" : "held";
            await markOutcome(batch, scope, error, outcome);
            throw withOutcome(error, outcome);
          }
          summary.attempted += batch.length;
          for (const row of batch) {
            const matches = result.results.filter((ack) => ack.txId === row.txId);
            if (matches.length === 1 && matches[0].ok === true) {
              await storage(() => store.deleteAward(row.txId, scope));
              summary.synced += 1;
              continue;
            }
            const ack = matches.length === 1 ? matches[0] : null;
            const outcome = ack ? classifyAwardFailure({ status: ack.status }) : "retry";
            await markOutcome([row], scope, ack?.error || "El servidor no confirmó esta operación", outcome);
            summary.failed += 1;
            if (outcome === "rejected") summary.rejected += 1;
            if (outcome === "held") summary.held += 1;
          }
          await onChange();
        }
        return summary;
      });
    }).finally(() => { syncFlight = null; });
    return syncFlight;
  }
  async function decide(txId, allowed, permission, change) {
    return exclusive(async () => {
      const scope = await authenticate(permission);
      if (!scope) throw new Error("Inicia sesión con la cuenta que registró la venta para decidir sobre ella.");
      return withLock(scope, async () => {
        const rows = await storage(() => store.listAwards({ ...scope, statuses: allowed }));
        const row = rows.find((candidate) => candidate.txId === txId);
        if (!row) throw new Error("Esta venta ya no espera una decisión en la cola de esta cuenta.");
        await storage(() => change(row, scope));
        await onChange();
        return row;
      });
    });
  }
  /** Moves a held sale back to the automatic queue and sends it with its original txId. */
  async function retry(txId) {
    await decide(txId, DECISION_STATUSES, "staff.sync", (row, scope) => store.updateAward(row.txId, { status: "queued", last_error: "" }, scope));
    if (syncFlight) await syncFlight.catch(() => {});
    return sync();
  }
  /** Removes a held or rejected sale from this device. It never touches sales the queue still retries. */
  function discard(txId) {
    return decide(txId, DISCARDABLE_STATUSES, "staff.award", (row, scope) => store.deleteAward(row.txId, scope));
  }
  return { submit, sync, retry, discard };
}
