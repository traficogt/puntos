import { withDbClientContext } from '../database.js';
import { runAutomationRule } from './automation-controls-service.js';

// Compatibility entry point: the legacy `days` argument cannot override the
// owner's saved winback rule. Preparing an incentive never sends it directly.
export async function runChurnOnce(
  { businessId, days: _days = undefined, now = new Date() },
  { context = withDbClientContext, runRule = runAutomationRule } = {}
) {
  return context({ tenantId: businessId, platformAdmin: false }, async () => {
    const outcome = await runRule({ businessId, rule: 'winback', now });
    return { ...outcome, sent: 0, failed: 0, suppressed: 0 };
  });
}
