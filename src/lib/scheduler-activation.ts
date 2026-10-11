import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
/**
 * Separate, default-off release gate for the central scheduler.
 *
 * WORKER_ENABLED controls the dedicated payroll job worker and MUST NOT
 * implicitly activate HR/compensation/statutory/retention scheduler jobs.
 * Only an exact lower-case "true" permits scheduler execution.
 *
 * This is an operational kill switch, not proof of external approval.
 */
export function isCentralSchedulerEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return criticalReleaseFlagEnabled("centralScheduler", env);
}
