import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";

type SourceFailure =
  | { ok: false; reason: "SOURCE_NOT_FOUND" }
  | { ok: false; reason: "SOURCE_ENTRY_COUNT" };

/**
 * No caller-supplied employee/run identifier can escape the requested tenant.
 * There is deliberately no unscoped fallback, even for owners.
 */
export async function loadReleasedOverpaymentEvidence(
  organizationId: number,
  employeeId: number,
  payrollRunId: number,
) {
  if (![organizationId, employeeId, payrollRunId].every(v => Number.isSafeInteger(v) && v > 0)) {
    return { ok: false, reason: "SOURCE_NOT_FOUND" } as SourceFailure;
  }
  const [[run], [worker], entries] = await Promise.all([
    db.select({
      id: payrollRuns.id, organizationId: payrollRuns.organizationId,
      periodLabel: payrollRuns.periodLabel, periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd, status: payrollRuns.status,
      scopeOrgUnitId: payrollRuns.scopeOrgUnitId,
      legalEntityId: payrollRuns.legalEntityId,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.id, payrollRunId),
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.status, "Released"),
    )).limit(1),
    db.select({
      id: employees.id, organizationId: employees.organizationId,
      orgUnitId: employees.orgUnitId, legalEntityId: employees.legalEntityId,
      employeeNo: employees.employeeNo,
      firstName: employees.firstName, lastName: employees.lastName,
    }).from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1),
    db.select({
      id: payrollEntries.id,
      payrollRunId: payrollEntries.payrollRunId,
      employeeId: payrollEntries.employeeId,
      grossPay: payrollEntries.grossPay,
      deductions: payrollEntries.deductions,
      netPay: payrollEntries.netPay,
      status: payrollEntries.status,
      lineItems: payrollEntries.lineItems,
      trace: payrollEntries.trace,
    }).from(payrollEntries).where(and(
      eq(payrollEntries.payrollRunId, payrollRunId),
      eq(payrollEntries.employeeId, employeeId),
    )).limit(2),
  ]);
  if (!run || !worker
    || (run.scopeOrgUnitId != null && run.scopeOrgUnitId !== worker.orgUnitId)) {
    return { ok: false, reason: "SOURCE_NOT_FOUND" } as SourceFailure;
  }
  if (entries.length !== 1) {
    return { ok: false, reason: "SOURCE_ENTRY_COUNT" } as SourceFailure;
  }
  return { ok: true as const, run, worker, entry: entries[0] };
}
