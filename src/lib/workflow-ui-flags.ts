import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type WorkflowUiFlags = {
  firstPayrollInline: boolean;
  importReview: boolean;
  coreOnlyNav: boolean;
  faceOfflinePunch: boolean;
  approvalBuilder: boolean;
  reportBuilder: boolean;
  benefitsLoans: boolean;
  recruitmentJourney: boolean;
};

export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> = Object.freeze({
  firstPayrollInline: false,
  importReview: false,
  coreOnlyNav: false,
  faceOfflinePunch: false,
  approvalBuilder: false,
  reportBuilder: false,
  benefitsLoans: false,
  recruitmentJourney: false,
});

/** Resolve only on the server. No NEXT_PUBLIC flags or client-side grants. */
export function resolveWorkflowUiFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowUiFlags {
  // These draft UIs predate per-employer grants. Hide them entirely when
  // multi-entity is on; the API/SSR boundaries independently reject requests.
  if (criticalReleaseFlagEnabled("multiEntity", env)) return { ...EMPTY_WORKFLOW_UI_FLAGS };
  return {
    firstPayrollInline: criticalReleaseFlagEnabled("workflowFirstPayrollAdvisory", env),
    importReview: criticalReleaseFlagEnabled("importReview", env),
    coreOnlyNav: criticalReleaseFlagEnabled("coreOnlyNav", env),
    faceOfflinePunch: criticalReleaseFlagEnabled("faceOfflinePunch", env),
    approvalBuilder: criticalReleaseFlagEnabled("approvalBuilder", env),
    reportBuilder: criticalReleaseFlagEnabled("reportBuilder", env),
    benefitsLoans: criticalReleaseFlagEnabled("benefitsLoans", env),
    recruitmentJourney: criticalReleaseFlagEnabled("recruitmentJourney", env),
  };
}
