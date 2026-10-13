import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** Legal-employer case isolation is deferred with the other multi-entity HCM surfaces. */
export function employeeHrCasesEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return criticalReleaseFlagEnabled("employeeHrCases", env) &&
    !criticalReleaseFlagEnabled("multiEntity", env);
}
