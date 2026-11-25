// Prometheus counter for the billing adapter (design section 9), registered on the
// shared /api/metrics registry. `type` is the normalized event or action name, never a
// business id, so the label set stays bounded.
import { Counter } from "@prometheus-io/client";
import { getRegistry } from "../../../middleware/metrics.js";

const events = new Counter({
  name: "puntos_billing_events_total",
  help: "Billing adapter events processed, by normalized type",
  labelNames: ["type"],
});
getRegistry().registerMetric(events);

/** @param {string} type */
export function countBillingEvent(type) {
  events.labels(String(type || "unknown")).inc();
}
