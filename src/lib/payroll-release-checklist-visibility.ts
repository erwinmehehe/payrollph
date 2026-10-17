/**
 * Release readiness is a derived UI snapshot, not an authority to release
 * payroll. Server-side release gates are mandatory regardless of this view.
 */
export type PayrollReleaseChecklistScope = Readonly<{
  organizationId: number;
  runId: number | null;
  payrollRuns: unknown;
  tasks: unknown;
}>;

export type ObservedPayrollReleaseChecklist<T> = Readonly<{
  scope: PayrollReleaseChecklistScope;
  checklist: T | null;
}>;

export function visiblePayrollReleaseChecklist<T>(
  current: PayrollReleaseChecklistScope,
  observed: ObservedPayrollReleaseChecklist<T> | null,
): T | null {
  if (current.runId == null || !observed) return null;

  const prior = observed.scope;
  return prior.organizationId === current.organizationId
    && prior.runId === current.runId
    && prior.payrollRuns === current.payrollRuns
    && prior.tasks === current.tasks
    ? observed.checklist
    : null;
}
