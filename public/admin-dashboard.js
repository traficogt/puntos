import { api, $, toast, modalAlert, modalConfirm, modalPrompt } from "/lib.js";
import { initAdminDashboard } from "./admin-dashboard/index.js";

await initAdminDashboard({ api, $, toast, alert: modalAlert, confirm: modalConfirm, prompt: modalPrompt });
