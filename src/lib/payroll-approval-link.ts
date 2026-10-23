import { criticalReleaseFlagEnabled } from "./critical-release-flags";

type ApprovalLink = { organizationId: number; payrollRunId: number | null; detail: string };

/** Exact FK wins over human-readable text. Legacy null-FK tasks use only the
 * canonical leading token, with a complete numeric boundary. */
export function approvalBelongsToPayrollRun(
  task: ApprovalLink,
  run: { id: number; organizationId: number },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!criticalReleaseFlagEnabled("exactPayrollApprovalLinks", env)) {
    return task.detail.includes(`Payroll run #${run.id}`);
  }
  if (!Number.isSafeInteger(run.id) || run.id < 1 || task.organizationId !== run.organizationId) return false;
  if (task.payrollRunId !== null) return task.payrollRunId === run.id;
  const token = /^Payroll run #([1-9]\d*)(?=$|[\s·.,;:])/.exec(task.detail);
  return token !== null && Number(token[1]) === run.id;
}
