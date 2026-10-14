import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export type WorkflowUiFlags = { benefitsLoans: boolean; recruitmentJourney: boolean };
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> =
  Object.freeze({ benefitsLoans: false, recruitmentJourney: false });
export function resolveWorkflowUiFlags(
  env: Readonly<Record<string,string|undefined>> = process.env,
): WorkflowUiFlags {
  const entityDeferred = criticalReleaseFlagEnabled("multiEntity", env);
  return {
    benefitsLoans: !entityDeferred && criticalReleaseFlagEnabled("benefitsLoans", env),
    recruitmentJourney: !entityDeferred && criticalReleaseFlagEnabled("recruitmentJourney", env),
  };
}
