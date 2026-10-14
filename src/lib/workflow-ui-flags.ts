import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export type WorkflowUiFlags = { benefitsLoans: boolean; reportBuilder: boolean; faceOfflinePunch: boolean };
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> =
  Object.freeze({ benefitsLoans: false, reportBuilder: false, faceOfflinePunch: false });

export function resolveWorkflowUiFlags(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowUiFlags {
  const singleEmployer = !criticalReleaseFlagEnabled("multiEntity", env);
  return {
    benefitsLoans: singleEmployer && criticalReleaseFlagEnabled("benefitsLoans", env),
    reportBuilder: singleEmployer && criticalReleaseFlagEnabled("reportBuilder", env),
    faceOfflinePunch: singleEmployer && criticalReleaseFlagEnabled("faceOfflinePunch", env),
  };
}
