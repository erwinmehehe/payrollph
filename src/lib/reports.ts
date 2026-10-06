import { and, avg, count, desc, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { employees, leaveRequests, openShiftClaims, openShifts, overtimeRequests, payrollEntries, payrollRuns, staffingRequirements, timePunches, workforceTimesheets } from "@/db/schema";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { buildEmploymentLifecycleGovernanceReport } from "@/lib/hcm-lifecycle-analytics";

export type ReportKey = "headcount" | "cost" | "turnover" | "compliance" | "assurance" | "workforce" | "lifecycle";

export const REPORT_DEFINITIONS: Array<{ key: ReportKey; name: string; description: string; columns: string[] }> = [
  { key: "headcount", name: "Headcount movement", description: "Active, leave, disciplinary and separating counts by employment type", columns: ["Employment type", "Status", "People", "Avg monthly basic"] },
  { key: "cost", name: "Payroll cost", description: "Gross, deductions and net by payroll run with rule version", columns: ["Period", "Scope", "Employees", "Gross", "Deductions", "Net"] },
  { key: "turnover", name: "Turnover risk", description: "Separating and disciplinary headcount share of the workforce", columns: ["Metric", "People", "Share of workforce"] },
  { key: "compliance", name: "Compliance exceptions", description: "Punch exceptions and flagged payroll entries requiring sign-off", columns: ["Type", "Count", "Detail"] },
  { key: "assurance", name: "Payroll assurance", description: "Latest payroll controls and employee variances against the previous run", columns: ["Severity", "Employee", "Control", "Detail", "Current", "Delta"] },
  { key: "workforce", name: "Workforce operations", description: "Trailing 30-day overtime, absence, coverage, schedule adherence, payroll variance and labor cost", columns: ["Metric", "Current", "Context"] },
  { key: "lifecycle", name: "Lifecycle governance", description: "Employment-term deadlines, decision flow, evidence coverage, non-renewal handoffs and notification escalations", columns: ["Metric", "Current", "Context"] },
];

export async function runReport(key: ReportKey, organizationId: number) {
  if (key === "lifecycle") {
    return buildEmploymentLifecycleGovernanceReport({ organizationId });
  }

  if (key === "headcount") {
    const rows = await db
      .select({
        employmentType: employees.employmentType,
        status: employees.status,
        people: count(),
        avgBasic: avg(employees.basicRate),
      })
      .from(employees)
      .where(eq(employees.organizationId, organizationId))
      .groupBy(employees.employmentType, employees.status)
      .orderBy(desc(count()));

    return {
      key,
      columns: REPORT_DEFINITIONS[0].columns,
      rows: rows.map((row) => [row.employmentType, row.status, String(row.people), Number(row.avgBasic ?? 0).toFixed(2)]),
    };
  }

  if (key === "cost") {
    const rows = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId))
      .orderBy(desc(payrollRuns.id));

    return {
      key,
      columns: REPORT_DEFINITIONS[1].columns,
      rows: rows.map((row) => [
        row.periodLabel,
        row.scopeLabel,
        String(row.employeeCount),
        Number(row.grossPay).toFixed(2),
        (Number(row.grossPay) - Number(row.netPay)).toFixed(2),
        Number(row.netPay).toFixed(2),
      ]),
    };
  }

  if (key === "turnover") {
    const [{ total }] = await db.select({ total: count() }).from(employees).where(eq(employees.organizationId, organizationId));
    const grouped = await db
      .select({ status: employees.status, people: count() })
      .from(employees)
      .where(eq(employees.organizationId, organizationId))
      .groupBy(employees.status);

    return {
      key,
      columns: REPORT_DEFINITIONS[2].columns,
      rows: grouped.map((row) => [
        row.status,
        String(row.people),
        total ? `${((Number(row.people) / Number(total)) * 100).toFixed(1)}%` : "0%",
      ]),
    };
  }

  if (key === "assurance") {
    const [currentRun] = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId))
      .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))
      .limit(1);
    if (!currentRun) return { key, columns: REPORT_DEFINITIONS[4].columns, rows: [] };

    const built = await buildPayrollAssurance(currentRun.id);
    if (!built) return { key, columns: REPORT_DEFINITIONS[4].columns, rows: [] };

    const employeeIds = [...new Set(
      built.assurance.findings
        .map((finding) => finding.employeeId)
        .filter((employeeId): employeeId is number => Number.isInteger(employeeId) && Number(employeeId) > 0),
    )];
    const staff = employeeIds.length
      ? await db.select({
          id: employees.id,
          employeeNo: employees.employeeNo,
          firstName: employees.firstName,
          lastName: employees.lastName,
        }).from(employees).where(and(
          eq(employees.organizationId, organizationId),
          inArray(employees.id, employeeIds),
        ))
      : [];
    const employeeById = new Map(staff.map((employee) => [employee.id, employee]));

    return {
      key,
      columns: REPORT_DEFINITIONS[4].columns,
      rows: built.assurance.findings
        .sort((a, b) => Number(Boolean(b.blocking)) - Number(Boolean(a.blocking)) || severityRank(b.severity) - severityRank(a.severity))
        .map((finding) => {
          const employee = finding.employeeId ? employeeById.get(finding.employeeId) : null;
          return [
            finding.blocking ? "Blocking" : finding.severity,
            employee ? `${employee.employeeNo} · ${employee.firstName} ${employee.lastName}` : "Payroll run",
            finding.title,
            finding.detail,
            finding.current == null ? "" : Number(finding.current).toFixed(2),
            finding.delta == null ? "" : Number(finding.delta).toFixed(2),
          ];
        }),
    };
  }


  if (key === "workforce") {
    const periodEnd = new Date();
    const periodStartDate = new Date(periodEnd);
    periodStartDate.setUTCDate(periodStartDate.getUTCDate() - 29);
    const periodStart = periodStartDate.toISOString().slice(0, 10);
    const periodEndIso = periodEnd.toISOString().slice(0, 10);

    const [overtimeRows, approvedLeave, staffing, openRows, timesheetTotals, recentPayroll] = await Promise.all([
      db.select({
        status: overtimeRequests.status,
        requests: count(),
        minutes: sum(overtimeRequests.requestedMinutes),
      }).from(overtimeRequests)
        .where(and(
          eq(overtimeRequests.organizationId, organizationId),
          gte(overtimeRequests.workDate, periodStart),
          lte(overtimeRequests.workDate, periodEndIso),
        ))
        .groupBy(overtimeRequests.status),
      db.select({
        requests: count(),
        days: sum(leaveRequests.days),
      }).from(leaveRequests)
        .where(and(
          eq(leaveRequests.organizationId, organizationId),
          eq(leaveRequests.status, "Approved"),
          lte(leaveRequests.startDate, periodEndIso),
          gte(leaveRequests.endDate, periodStart),
        )),
      db.select({
        requiredSlots: sum(staffingRequirements.requiredHeadcount),
      }).from(staffingRequirements)
        .where(and(
          eq(staffingRequirements.organizationId, organizationId),
          gte(staffingRequirements.workDate, periodStart),
          lte(staffingRequirements.workDate, periodEndIso),
        )),
      db.select({
        id: openShifts.id,
        slots: openShifts.slots,
      }).from(openShifts)
        .where(and(
          eq(openShifts.organizationId, organizationId),
          eq(openShifts.status, "open"),
          gte(openShifts.workDate, periodStart),
          lte(openShifts.workDate, periodEndIso),
        )),
      db.select({
        scheduledMinutes: sum(workforceTimesheets.scheduledMinutes),
        workedMinutes: sum(workforceTimesheets.workedMinutes),
        overtimeMinutes: sum(workforceTimesheets.overtimeMinutes),
      }).from(workforceTimesheets)
        .where(and(
          eq(workforceTimesheets.organizationId, organizationId),
          eq(workforceTimesheets.status, "approved"),
          lte(workforceTimesheets.periodStart, periodEndIso),
          gte(workforceTimesheets.periodEnd, periodStart),
        )),
      db.select({
        periodLabel: payrollRuns.periodLabel,
        grossPay: payrollRuns.grossPay,
        netPay: payrollRuns.netPay,
        payDate: payrollRuns.payDate,
      }).from(payrollRuns)
        .where(eq(payrollRuns.organizationId, organizationId))
        .orderBy(desc(payrollRuns.payDate), desc(payrollRuns.id))
        .limit(2),
    ]);

    const approvedClaims = openRows.length
      ? await db.select({
          openShiftId: openShiftClaims.openShiftId,
          filled: count(),
        }).from(openShiftClaims)
          .where(and(
            inArray(openShiftClaims.openShiftId, openRows.map((row) => row.id)),
            eq(openShiftClaims.status, "approved"),
          ))
          .groupBy(openShiftClaims.openShiftId)
      : [];
    const approvedByShift = new Map(approvedClaims.map((row) => [row.openShiftId, Number(row.filled)]));
    const unfilledOpenSlots = openRows.reduce(
      (total, row) => total + Math.max(0, Number(row.slots) - (approvedByShift.get(row.id) ?? 0)),
      0,
    );

    const overtime = new Map(overtimeRows.map((row) => [
      String(row.status).toLowerCase(),
      { requests: Number(row.requests), minutes: Number(row.minutes ?? 0) },
    ]));
    const requestedOt = [...overtime.values()].reduce(
      (total, row) => ({ requests: total.requests + row.requests, minutes: total.minutes + row.minutes }),
      { requests: 0, minutes: 0 },
    );
    const approvedOt = overtime.get("approved") ?? { requests: 0, minutes: 0 };
    const scheduledMinutes = Number(timesheetTotals[0]?.scheduledMinutes ?? 0);
    const workedMinutes = Number(timesheetTotals[0]?.workedMinutes ?? 0);
    const timesheetOtMinutes = Number(timesheetTotals[0]?.overtimeMinutes ?? 0);
    const adherence = scheduledMinutes > 0 ? workedMinutes / scheduledMinutes * 100 : 0;

    const currentPayroll = recentPayroll[0];
    const previousPayroll = recentPayroll[1];
    const currentGross = Number(currentPayroll?.grossPay ?? 0);
    const previousGross = Number(previousPayroll?.grossPay ?? 0);
    const grossDelta = currentGross - previousGross;
    const grossVariancePct = previousGross > 0 ? grossDelta / previousGross * 100 : 0;

    return {
      key,
      columns: REPORT_DEFINITIONS[5].columns,
      rows: [
        ["Window", "Trailing 30 days", `${periodStart} to ${periodEndIso}`],
        ["Overtime requested", `${(requestedOt.minutes / 60).toFixed(1)} h`, `${requestedOt.requests} request${requestedOt.requests === 1 ? "" : "s"}`],
        ["Overtime approved", `${(approvedOt.minutes / 60).toFixed(1)} h`, `${approvedOt.requests} approved request${approvedOt.requests === 1 ? "" : "s"}`],
        ["Approved absence", `${Number(approvedLeave[0]?.days ?? 0).toFixed(1)} days`, `${Number(approvedLeave[0]?.requests ?? 0)} approved request(s) overlapping the window`],
        ["Staffing demand", `${Number(staffing[0]?.requiredSlots ?? 0)} shift slots`, `${unfilledOpenSlots} currently unfilled open-shift slot(s)`],
        ["Schedule adherence", `${(workedMinutes / 60).toFixed(1)} / ${(scheduledMinutes / 60).toFixed(1)} h`, `${adherence.toFixed(1)}% actual vs scheduled from approved timesheets`],
        ["Timesheet overtime", `${(timesheetOtMinutes / 60).toFixed(1)} h`, "Approved timesheet overtime in overlapping periods"],
        ["Payroll variance", `${grossDelta.toFixed(2)}`, previousPayroll ? `${grossVariancePct.toFixed(1)}% gross vs ${previousPayroll.periodLabel}` : "No previous payroll run available"],
        ["Labor cost", `${currentGross.toFixed(2)}`, currentPayroll ? `Latest payroll gross · ${currentPayroll.periodLabel}` : "No payroll run available"],
      ],
    };
  }

  const [punchExceptions] = await db
    .select({ value: count() })
    .from(timePunches)
    .where(and(eq(timePunches.organizationId, organizationId), sql`${timePunches.status} <> 'Complete'`));

  const [missingOut] = await db
    .select({ value: count() })
    .from(timePunches)
    .where(and(eq(timePunches.organizationId, organizationId), sql`${timePunches.timeOut} is null`));

  const flaggedEntries = await db
    .select({ value: count() })
    .from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(eq(payrollRuns.organizationId, organizationId), eq(payrollEntries.status, "Exception")));

  const [exceptionTotals] = await db
    .select({ gross: sum(payrollRuns.grossPay), runs: count() })
    .from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId));

  return {
    key,
    columns: REPORT_DEFINITIONS[3].columns,
    rows: [
      ["Punch exceptions", String(punchExceptions?.value ?? 0), "Derived from raw punch status"],
      ["Missing clock-out", String(missingOut?.value ?? 0), "Derives zero hours, needs sign-off"],
      ["Flagged payroll entries", String(flaggedEntries[0]?.value ?? 0), "Blocked from clean release"],
      ["Payroll runs on record", String(exceptionTotals?.runs ?? 0), `Total gross ${Number(exceptionTotals?.gross ?? 0).toFixed(2)}`],
    ],
  };
}

function severityRank(severity: "high" | "medium" | "info") {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

export { toCsv as reportToCsv } from "@/lib/csv";
