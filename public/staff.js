import { api, $, toast, uuidv4, hydrateShellLinks } from "/lib.js";
import { addAward, deleteAward, listAwards } from "/idb.js";
import { initStaffPage } from "./staff/index.js";

/** @typedef {import("./staff/types.js").QueuedStaffAward} QueuedStaffAward */

/**
 * @param {QueuedStaffAward} award
 * @returns {Promise<unknown>}
 */
function putQueuedAward(award) {
  return addAward(award);
}

/**
 * @returns {Promise<QueuedStaffAward[]>}
 */
function getQueuedAwards() {
  return listAwards();
}

hydrateShellLinks();

initStaffPage({ api, $, toast, uuidv4, addAward: putQueuedAward, listAwards: getQueuedAwards, deleteAward }).catch((e) => {
  console.error(e);
  toast(e?.message || "Error");
});
