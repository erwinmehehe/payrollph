import { and, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db";
import { historicalPayrollEntries, payrollEntries, payrollRuns } from "@/db/schema";
import { buildBir2316MappingPreview } from "./bir-2316-mapping-preview";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read within the existing annual certificate snapshot, after employer and employee attribution. */
export async function readBir2316MappingPreview(
  tx: Transaction,
  scope: Parameters<typeof buildBir2316MappingPreview>[0],
  annual: Parameters<typeof buildBir2316MappingPreview>[3],
) {
  const { organizationId, employeeId, taxYear } = scope;
  const from = `${taxYear}-01-01`;
  const through = `${taxYear}-12-31`;
  const released = await tx.select({
    id: payrollEntries.id, runId: payrollRuns.id, organizationId: payrollRuns.organizationId,
    employeeId: payrollEntries.employeeId, legalEntityId: payrollRuns.legalEntityId, payDate: payrollRuns.payDate,
    periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd, grossPay: payrollEntries.grossPay,
    status: payrollRuns.status, lineItems: payrollEntries.lineItems, trace: payrollEntries.trace,
  }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollRuns.id, payrollEntries.payrollRunId)).where(and(
    eq(payrollRuns.organizationId, organizationId), eq(payrollEntries.employeeId, employeeId),
    eq(payrollRuns.status, "Released"), gte(payrollRuns.payDate, from), lte(payrollRuns.payDate, through),
  ));
  const imported = await tx.select({
    id: historicalPayrollEntries.id, payDate: historicalPayrollEntries.payDate,
    grossPay: historicalPayrollEntries.grossPay, basicSalary: historicalPayrollEntries.basicSalary,
  }).from(historicalPayrollEntries).where(and(
    eq(historicalPayrollEntries.organizationId, organizationId), eq(historicalPayrollEntries.employeeId, employeeId),
    gte(historicalPayrollEntries.payDate, from), lte(historicalPayrollEntries.payDate, through),
  ));
  return buildBir2316MappingPreview(scope, released, imported, annual);
}
