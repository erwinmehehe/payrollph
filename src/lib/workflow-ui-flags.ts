import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type WorkflowUiFlags = {
  firstPayrollInline: boolean;
  importReview: boolean;
  coreOnlyNav: boolean;
  faceOfflinePunch: boolean;
  rosterPublish: boolean;
  approvalBuilder: boolean;
  reportBuilder: boolean;
  benefitsLoans: boolean;
  recruitmentJourney: boolean;
  employeeCases: boolean;
};

export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> = Object.freeze({
  firstPayrollInline: false,
  importReview: false,
  coreOnlyNav: false,
  faceOfflinePunch: false,
  rosterPublish: false,
  approvalBuilder: false,
  reportBuilder: false,
  benefitsLoans: false,
  recruitmentJourney: false,
  employeeCases: false,
});

/** Resolve only on the server. No NEXT_PUBLIC flags or client-side grants. */
export function resolveWorkflowUiFlags(): WorkflowUiFlags {
  return {
    firstPayrollInline: criticalReleaseFlagEnabled("firstPayrollInline"),
    importReview: criticalReleaseFlagEnabled("importReview"),
    coreOnlyNav: criticalReleaseFlagEnabled("coreOnlyNav"),
    faceOfflinePunch: criticalReleaseFlagEnabled("faceOfflinePunch"),
    rosterPublish: criticalReleaseFlagEnabled("rosterPublish"),
    approvalBuilder: criticalReleaseFlagEnabled("approvalBuilder"),
    reportBuilder: criticalReleaseFlagEnabled("reportBuilder"),
    benefitsLoans: criticalReleaseFlagEnabled("benefitsLoans"),
    recruitmentJourney: criticalReleaseFlagEnabled("recruitmentJourney"),
    employeeCases: criticalReleaseFlagEnabled("employeeCases"),
  };
}
