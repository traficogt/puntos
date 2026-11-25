// Prometheus counters for the self-serve trial funnel (design section 9), registered
// on the shared /api/metrics registry.
import { Counter } from "@prometheus-io/client";
import { getRegistry } from "../../middleware/metrics.js";

/** @typedef {"code_requested" | "code_verified" | "created"} TrialSignupStep */
/** @typedef {"locked" | "converted" | "purged" | "extended" | "purge_candidate"} TrialTransition */

const signups = new Counter({
  name: "puntos_trial_signups_total",
  help: "Self-serve trial signup steps completed",
  labelNames: ["step"],
});
const transitions = new Counter({
  name: "puntos_trial_transitions_total",
  help: "Trial state transitions applied by the platform",
  labelNames: ["to"],
});
getRegistry().registerMetric(signups);
getRegistry().registerMetric(transitions);

/** @param {TrialSignupStep} step */
export function countTrialSignupStep(step) {
  signups.labels(step).inc();
}

/** @param {TrialTransition} to */
export function countTrialTransition(to) {
  transitions.labels(to).inc();
}
