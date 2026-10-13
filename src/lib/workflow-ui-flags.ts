import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export type WorkflowUiFlags = { reportBuilder: boolean };
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags> = Object.freeze({reportBuilder:false});
export function resolveWorkflowUiFlags(env: Readonly<Record<string,string|undefined>> = process.env): WorkflowUiFlags {
 return { reportBuilder: !criticalReleaseFlagEnabled("multiEntity",env) && criticalReleaseFlagEnabled("reportBuilder",env) };
}
