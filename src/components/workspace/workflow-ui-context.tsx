"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorkflowUiFlags } from "@/lib/workflow-ui-flags";
import { EMPTY_WORKFLOW_UI_FLAGS } from "@/lib/workflow-ui-flags";

/** Render nothing when flags are off; context does not weaken API authorization. */
const WorkflowUiContext = createContext<Readonly<WorkflowUiFlags>>(EMPTY_WORKFLOW_UI_FLAGS);

export function WorkflowUiProvider({ flags, children }: {
  flags: Readonly<WorkflowUiFlags>;
  children?: ReactNode;
}) {
  return <WorkflowUiContext.Provider value={flags}>{children}</WorkflowUiContext.Provider>;
}

export function useWorkflowUi(): Readonly<WorkflowUiFlags> {
  return useContext(WorkflowUiContext);
}
