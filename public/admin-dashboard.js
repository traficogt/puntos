import { api, $, toast, modalAlert, modalConfirm, modalPrompt } from "/lib.js";
import { ensureAdminDashboardLayout } from "./admin-dashboard/layout.js";
import { initAdminDashboard } from "./admin-dashboard/index.js";

await ensureAdminDashboardLayout();
await initAdminDashboard({ api, $, toast, alert: modalAlert, confirm: modalConfirm, prompt: modalPrompt });
