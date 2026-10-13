import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export type WorkflowUiFlags = { faceOfflinePunch: boolean };
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> = Object.freeze({ faceOfflinePunch: false });
export function resolveWorkflowUiFlags(env: Readonly<Record<string,string|undefined>> = process.env): WorkflowUiFlags {
  return { faceOfflinePunch: !criticalReleaseFlagEnabled("multiEntity",env) && criticalReleaseFlagEnabled("faceOfflinePunch",env) };
}
