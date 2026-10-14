import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type WorkflowUiFlags = {
  benefitsLoans: boolean;
  reportBuilder: boolean;
  recruitmentJourney: boolean;
};
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> =
  Object.freeze({ benefitsLoans: false, reportBuilder: false, recruitmentJourney: false });

export function resolveWorkflowUiFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowUiFlags {
  // Each capability is independently default-OFF; none is available in the
  // deferred multi-legal-entity workflow, including owner/HR sessions.
  const singleEmployer = !criticalReleaseFlagEnabled("multiEntity", env);
  return {
    benefitsLoans: singleEmployer && criticalReleaseFlagEnabled("benefitsLoans", env),
    reportBuilder: singleEmployer && criticalReleaseFlagEnabled("reportBuilder", env),
    recruitmentJourney: singleEmployer && criticalReleaseFlagEnabled("recruitmentJourney", env),
  };
}
