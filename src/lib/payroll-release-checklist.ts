import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, payrollEntries, payrollRuns } from "@/db/schema";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

export type PayrollReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "approval" | "bank";
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
};

export async function buildPayrollReleaseChecklist(
  runId: number,
  options: { acknowledgeExceptions?: boolean } = {},
) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return null;

  const rows = await db
    .select({ entry: payrollEntries, employee: employees })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, run.id));

  const approvalRows = await db
    .select()
    .from(approvalTasks)
    .where(eq(approvalTasks.organizationId, run.organizationId));
  const approval = approvalRows
    .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
    .sort((a, b) => b.id - a.id)[0] ?? null;

  const assuranceResult = await buildPayrollAssurance(run.id);
  const findings = assuranceResult?.assurance.findings ?? [];
  const blockers = findings.filter((finding) => finding.blocking);
  const missingAttendance = findings.filter((finding) => finding.code === "MISSING_ATTENDANCE");
  const statutoryReview = findings.filter((finding) => finding.code === "MISSING_STATUTORY");
  const missingBank = findings.filter((finding) => finding.code === "MISSING_BANK_DETAILS");

  const expectedEntries = run.employeeCount;
  const calculationComplete =
    rows.length > 0 &&
    expectedEntries > 0 &&
    rows.length === expectedEntries &&
    Number(run.totalChunks ?? 0) > 0 &&
    Number(run.processedChunks ?? 0) >= Number(run.totalChunks ?? 0) &&
    !["Draft", "Queued", "Processing", "Recalculating", "Failed"].includes(run.status);

  const inputsComplete =
    rows.length > 0 &&
    rows.every(({ employee }) =>
      Boolean(employee.employeeNo?.trim()) &&
      Number(employee.basicRate) > 0 &&
      Boolean(employee.startDate)
    );

  const attendancePassed =
    missingAttendance.length === 0 ||
    Boolean(options.acknowledgeExceptions);

  const bankPassed = rows.length > 0 && missingBank.length === 0;
  const statutoryPassed = statutoryReview.length === 0;
  const approvalPassed = approval?.status === "Approved";
  const exceptionPassed =
    blockers.filter((finding) => finding.code !== "MISSING_BANK_DETAILS").length === 0 &&
    (run.exceptions === 0 || Boolean(options.acknowledgeExceptions));

  const items: PayrollReleaseChecklistItem[] = [
    {
      key: "inputs",
      label: "Employee inputs",
      passed: inputsComplete,
      blocking: true,
      detail: inputsComplete
        ? `${rows.length} payroll employee record(s) have the required payroll inputs.`
        : "One or more payroll employees are missing a valid employee number, basic rate, or start date.",
    },
    {
      key: "attendance",
      label: "Attendance",
      passed: attendancePassed,
      blocking: true,
      detail: missingAttendance.length === 0
        ? "No employee used the no-punch fallback for this cutoff."
        : options.acknowledgeExceptions
          ? `${missingAttendance.length} no-attendance exception(s) were explicitly acknowledged for release.`
          : `${missingAttendance.length} employee(s) have no attendance in the cutoff and need review or explicit exception acknowledgement.`,
    },
    {
      key: "calculation",
      label: "Payroll calculation",
      passed: calculationComplete,
      blocking: true,
      detail: calculationComplete
        ? `${rows.length}/${expectedEntries} employee entries are calculated and every chunk is complete.`
        : `Calculation is incomplete: ${rows.length}/${expectedEntries} employee entries, ${run.processedChunks ?? 0}/${run.totalChunks ?? 0} chunks.`,
    },
    {
      key: "exceptions",
      label: "Exceptions",
      passed: exceptionPassed,
      blocking: true,
      detail: exceptionPassed
        ? blockers.length === 0
          ? "No blocking payroll-assurance findings remain."
          : "Release-blocking findings were resolved or explicitly acknowledged where allowed."
        : `${blockers.length} blocking assurance finding(s) or ${run.exceptions} engine exception(s) still require action.`,
    },
    {
      key: "statutory",
      label: "Statutory calculations",
      passed: statutoryPassed,
      blocking: true,
      detail: statutoryPassed
        ? "SSS, PhilHealth and Pag-IBIG treatment is present for compensation that requires it."
        : `${statutoryReview.length} employee(s) have statutory line items that need confirmation before release.`,
    },
    {
      key: "approval",
      label: "Checker approval",
      passed: approvalPassed,
      blocking: true,
      detail: approvalPassed
        ? `Approved by ${approval?.decidedBy ?? approval?.approver ?? "the assigned checker"}.`
        : approval?.status === "Pending"
          ? `Waiting for ${approval.approver} to approve this run.`
          : "This payroll run does not have a current approved checker task.",
    },
    {
      key: "bank",
      label: "Bank file readiness",
      passed: bankPassed,
      blocking: true,
      detail: bankPassed
        ? "Every employee with positive net pay has a bank account and bank code."
        : `${missingBank.length} employee(s) with positive net pay have incomplete bank details.`,
    },
  ];

  return {
    run,
    approval,
    assurance: assuranceResult?.assurance ?? null,
    entryCount: rows.length,
    items,
    ready: items.filter((item) => item.blocking).every((item) => item.passed),
  };
}
