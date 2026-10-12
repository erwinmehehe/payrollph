import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { authorizeExtendedV1Read, apiV1Page } from "@/lib/api-v1-extended";

export const dynamic = "force-dynamic";

/** Metadata and stored final amounts only; never raw payslip traces, bank or statutory IDs. */
export async function GET(request: Request) {
  const gate = await authorizeExtendedV1Read(request, "payroll:read");
  if (!gate.ok) return gate.response;
  const params = new URL(request.url).searchParams;
  const page = apiV1Page(params);
  if (!page) return Response.json({ error: "Invalid limit or offset." }, { status: 400 });
  const runIdText = params.get("payrollRunId");
  const employeeIdText = params.get("employeeId");
  const runId = runIdText === null ? null : Number(runIdText);
  const employeeId = employeeIdText === null ? null : Number(employeeIdText);
  if ((runId !== null && (!Number.isSafeInteger(runId) || runId < 1))
    || (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId < 1))) {
    return Response.json({ error: "Invalid employeeId or payrollRunId." }, { status: 400 });
  }
  const conditions = and(
    eq(payrollRuns.organizationId, gate.auth.organizationId),
    eq(payrollRuns.status, "Released"),
    runId !== null ? eq(payrollRuns.id, runId) : undefined,
    employeeId !== null ? eq(payrollEntries.employeeId, employeeId) : undefined,
  );
  const [rows, totals] = await Promise.all([
    db.select({
      id: payrollEntries.id, payrollRunId: payrollRuns.id,
      legalEntityId: payrollRuns.legalEntityId,
      employeeId: employees.id, employeeNo: employees.employeeNo,
      payDate: payrollRuns.payDate, periodStart: payrollRuns.periodStart,
      periodEnd: payrollRuns.periodEnd, grossPay: payrollEntries.grossPay,
      deductions: payrollEntries.deductions, netPay: payrollEntries.netPay,
    }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .innerJoin(employees, and(
        eq(payrollEntries.employeeId, employees.id),
        eq(employees.organizationId, payrollRuns.organizationId),
      )).where(conditions).orderBy(asc(payrollEntries.id))
      .limit(page.limit).offset(page.offset),
    db.select({ value: count() }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .innerJoin(employees, and(
        eq(payrollEntries.employeeId, employees.id),
        eq(employees.organizationId, payrollRuns.organizationId),
      )).where(conditions),
  ]);
  const total = totals[0]?.value ?? 0;
  return Response.json({
    object: "list", total, ...page, hasMore: page.offset + rows.length < total,
    data: rows, note: "Released stored payslip amounts only; detailed payroll evidence is restricted.",
  }, { headers: { "Cache-Control": "no-store" } });
}
