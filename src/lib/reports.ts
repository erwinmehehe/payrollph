import { and, avg, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns, timePunches } from "@/db/schema";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

export type ReportKey = "headcount" | "cost" | "turnover" | "compliance" | "assurance";

export const REPORT_DEFINITIONS: Array<{ key: ReportKey; name: string; description: string; columns: string[] }> = [
  { key: "headcount", name: "Headcount movement", description: "Active, leave, disciplinary and separating counts by employment type", columns: ["Employment type", "Status", "People", "Avg monthly basic"] },
  { key: "cost", name: "Payroll cost", description: "Gross, deductions and net by payroll run with rule version", columns: ["Period", "Scope", "Employees", "Gross", "Deductions", "Net"] },
  { key: "turnover", name: "Turnover risk", description: "Separating and disciplinary headcount share of the workforce", columns: ["Metric", "People", "Share of workforce"] },
  { key: "compliance", name: "Compliance exceptions", description: "Punch exceptions and flagged payroll entries requiring sign-off", columns: ["Type", "Count", "Detail"] },
  { key: "assurance", name: "Payroll assurance", description: "Latest payroll controls and employee variances against the previous run", columns: ["Severity", "Employee", "Control", "Detail", "Current", "Delta"] },
];

export async function runReport(key: ReportKey, organizationId: number) {
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
