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

  // Scope identity changes on every employer/run/approval snapshot transition.
  // A -> B -> A must not resurrect the first A request while a fresh GET runs.
  return observed.scope === current ? observed.checklist : null;
}
