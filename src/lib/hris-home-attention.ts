import type { Task } from "@/components/workspace/types";
import {
  buildOnboardingChecklistGroups,
  type OnboardingEmployee,
  type OnboardingTask,
} from "@/lib/hris-onboarding-checklist";

export type EverydayHrAttention = {
  onboarding: null | {
    recordedWorkers: number;
    openWorkers: number;
    openTasks: number;
  };
  pendingApprovals: number;
};

/**
 * Read-only attention summary from the already-authorized, selected-employer
 * dashboard snapshot. Does not fabricate missing onboarding tasks or approvals.
 * Unknown provisioning coverage stays null, never a misleading zero.
 */
export function summarizeEverydayHrAttention({
  employees,
  provisioning,
  approvals,
}: {
  employees: readonly OnboardingEmployee[];
  provisioning: readonly OnboardingTask[] | undefined;
  approvals: readonly Pick<Task, "status">[];
}): EverydayHrAttention {
  const recorded = provisioning === undefined
    ? null
    : buildOnboardingChecklistGroups(employees, provisioning);

  return {
    onboarding: recorded === null ? null : {
      recordedWorkers: recorded.length,
      openWorkers: recorded.filter(group => group.remaining > 0).length,
      openTasks: recorded.reduce((total, group) => total + group.remaining, 0),
    },
    pendingApprovals: approvals.filter(task => task.status === "Pending").length,
  };
}
