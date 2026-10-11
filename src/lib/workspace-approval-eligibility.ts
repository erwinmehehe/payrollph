import type { Delegation, Task } from "@/components/workspace/types";
import { manilaCalendarDate } from "@/lib/payroll-period-ui";

/** Pure presentation-only mirror of named/role and date-bounded delegation matching.
 * Server-side canDecide(), maker-checker checks, task/snapshot integrity and
 * organization-unit constraints remain authoritative on every decision.
 */
const APPROVER_ROLES: Readonly<Record<string, readonly string[]>> = {
  "role:hr": ["hr", "admin", "owner"],
  "role:finance": ["bookkeeper", "admin", "owner"],
  "role:owner": ["owner"],
  "role:manager": ["manager", "admin", "owner"],
};

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("en");
}

export function assignedToViewer(
  approver: string,
  actorName: string | null | undefined,
  role: string | null | undefined,
  delegations: readonly Delegation[],
  today: string = manilaCalendarDate(),
): boolean {
  const approverKey = normalized(approver);
  const actorKey = normalized(actorName);
  if (!approverKey || !actorKey) return false;

  // Role-target approval is still checked against active org membership by the API.
  const acceptedRoles = APPROVER_ROLES[approverKey];
  if (acceptedRoles?.includes(normalized(role))) return true;
  if (approverKey === actorKey) return true;

  const seen = new Set([approverKey]);
  let current = approverKey;
  // Match the server's cycle-safe, at-most-three-hop delegated approval chain.
  for (let depth = 0; depth < 3; depth += 1) {
    const match = delegations.find(
      (delegation) =>
        delegation.active &&
        normalized(delegation.fromApprover) === current &&
        delegation.startsOn <= today &&
        delegation.endsOn >= today,
    );
    if (!match) break;
    const next = normalized(match.toApprover);
    if (!next || seen.has(next)) break;
    if (next === actorKey) return true;
    seen.add(next);
    current = next;
  }
  return false;
}

export function decisionVisibleToViewer(input: {
  task: Task;
  actorName: string | null | undefined;
  role: string | null | undefined;
  delegations: readonly Delegation[];
  canDecide: boolean;
  today?: string;
}) {
  return Boolean(
    input.canDecide &&
    input.task.status === "Pending" &&
    assignedToViewer(input.task.approver, input.actorName, input.role, input.delegations, input.today),
  );
}

export function viewerApprovalCounts(input: {
  tasks: readonly Task[];
  actorName: string | null | undefined;
  role: string | null | undefined;
  delegations: readonly Delegation[];
  canDecide: boolean;
  today?: string;
}) {
  const pending = input.tasks.filter((task) => task.status === "Pending");
  return {
    pending: pending.length,
    mine: pending.filter((task) => decisionVisibleToViewer({ ...input, task })).length,
    high: pending.filter((task) => task.priority === "High").length,
    decided: input.tasks.length - pending.length,
  };
}
