import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type WorkflowUiFlags = {
  benefitsLoans: boolean;
  reportBuilder: boolean;
  faceOfflinePunch: boolean;
  recruitmentJourney: boolean;
};
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> =
  Object.freeze({ benefitsLoans: false, reportBuilder: false, faceOfflinePunch: false, recruitmentJourney: false });

export function resolveWorkflowUiFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowUiFlags {
  // Four independent, default-OFF UI capabilities. The same entity hold
  // applies to each; UI flags never replace server-side role/security gates.
  const singleEmployer = !criticalReleaseFlagEnabled("multiEntity", env);
  return {
    benefitsLoans: singleEmployer && criticalReleaseFlagEnabled("benefitsLoans", env),
    reportBuilder: singleEmployer && criticalReleaseFlagEnabled("reportBuilder", env),
    faceOfflinePunch: singleEmployer && criticalReleaseFlagEnabled("faceOfflinePunch", env),
    recruitmentJourney: singleEmployer && criticalReleaseFlagEnabled("recruitmentJourney", env),
  };
}
