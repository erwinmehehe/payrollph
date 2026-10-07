import type { AuditEvent, DashboardData } from "./types";

/** Workspace-wide record checks, not a payroll release checklist. */
export function summarizePeopleRecords(data: DashboardData) {
  const active = data.employees.filter((employee) => employee.status === "Active");
  const activeIds = new Set(active.map((employee) => employee.id));
  const missingBank = active.filter((employee) => !employee.bankAccount || !employee.bankCode);
  const missingIds = active.filter((employee) => !employee.tin || !employee.sssNo || !employee.philHealthNo || !employee.pagIbigNo);
  const attendance = (data.punches ?? []).filter((punch) => activeIds.has(punch.employeeId) && (!punch.timeIn || !punch.timeOut));
  const provisioning = (data.provisioning ?? []).filter((task) => activeIds.has(task.employeeId) && !task.done);
  const attentionIds = new Set([...missingBank, ...missingIds, ...attendance, ...provisioning].map((row) => "employeeId" in row ? row.employeeId : row.id));
  return { active, missingBank, missingIds, attendance, provisioning, attention: active.filter((employee) => attentionIds.has(employee.id)) };
}

/** Export generation does not prove bank reconciliation or agency filing. */
export function summarizeCloseEvidence(events: AuditEvent[], runId?: number) {
  const scoped = runId === undefined ? [] : events.filter((event) => event.metadata && typeof event.metadata === "object" && Number((event.metadata as Record<string, unknown>).runId) === runId);
  const has = (...actions: string[]) => scoped.some((event) => actions.includes(event.action));
  return {
    paid: has("Payroll payout completed manually", "Payroll payout completed via PayMongo"),
    bankExport: has("bank export generated"),
    journal: has("journal export generated"),
    government: has("government export generated"),
    closed: has("Payroll close completed"),
  };
}
