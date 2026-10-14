import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export type WorkflowUiFlags={benefitsLoans:boolean};
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags>=Object.freeze({benefitsLoans:false});
export function resolveWorkflowUiFlags(env: Readonly<Record<string,string|undefined>>=process.env):WorkflowUiFlags{
 return {benefitsLoans: !criticalReleaseFlagEnabled("multiEntity",env) && criticalReleaseFlagEnabled("benefitsLoans",env)};
}
