import { and, avg, count, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns, timePunches } from "@/db/schema";

export type ReportKey = "headcount" | "cost" | "turnover" | "compliance";

export const REPORT_DEFINITIONS: Array<{ key: ReportKey; name: string; description: string; columns: string[] }> = [
  { key: "headcount", name: "Headcount movement", description: "Active, leave, disciplinary and separating counts by employment type", columns: ["Employment type", "Status", "People", "Avg monthly basic"] },
  { key: "cost", name: "Payroll cost", description: "Gross, deductions and net by payroll run with rule version", columns: ["Period", "Scope", "Employees", "Gross", "Deductions", "Net"] },
  { key: "turnover", name: "Turnover risk", description: "Separating and disciplinary headcount share of the workforce", columns: ["Metric", "People", "Share of workforce"] },
  { key: "compliance", name: "Compliance exceptions", description: "Punch exceptions and flagged payroll entries requiring sign-off", columns: ["Type", "Count", "Detail"] },
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

export { toCsv as reportToCsv } from "@/lib/csv";
