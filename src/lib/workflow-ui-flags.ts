import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
export type WorkflowUiFlags={recruitmentJourney:boolean};
export const EMPTY_WORKFLOW_UI_FLAGS: Readonly<WorkflowUiFlags>=Object.freeze({recruitmentJourney:false});
export function resolveWorkflowUiFlags(env: Readonly<Record<string,string|undefined>>=process.env):WorkflowUiFlags{
 return {recruitmentJourney:!criticalReleaseFlagEnabled("multiEntity",env)&&criticalReleaseFlagEnabled("recruitmentJourney",env)};
}
