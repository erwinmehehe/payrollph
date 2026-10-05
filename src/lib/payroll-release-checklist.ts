import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  employees,
  payrollEntries,
  payrollRuns,
  payslips,
  statutoryRemittanceObligations,
} from "@/db/schema";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

export type PayrollReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "payslips" | "remittance" | "approval" | "bank";
  label: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

export async function buildPayrollReleaseChecklist(runId: number, options: { acknowledgeExceptions?: boolean; allowRedactedDemoPayout?: boolean } = {}) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return null;

  const rows = await db.select({ entry: payrollEntries, employee: employees })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, run.id));

  const approvalRows = await db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, run.organizationId));
  const approval = approvalRows
    .filter((task) => task.detail.includes(`Payroll run #${run.id}`))
    .sort((a,b) => b.id - a.id)[0] ?? null;
  const entryIds = rows.map(({ entry }) => entry.id);
  const [payslipRows, remittanceRows] = await Promise.all([
    entryIds.length
      ? db.select({
          payrollEntryId: payslips.payrollEntryId,
          content: payslips.content,
        }).from(payslips).where(inArray(payslips.payrollEntryId, entryIds))
      : Promise.resolve([]),
    db.select().from(statutoryRemittanceObligations)
      .where(eq(statutoryRemittanceObligations.organizationId, run.organizationId)),
  ]);
  const todayPh = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(new Date());
  const currentMonth = todayPh.slice(0, 7);
  const overdueRemittances = remittanceRows.filter((row) => {
    if (row.status === "confirmed") return false;
    const applicableMonth = String(row.applicableMonth);
    const dueDate = row.dueDate ? String(row.dueDate) : null;
    return dueDate
      ? dueDate < todayPh
      : applicableMonth < currentMonth;
  });

  const assuranceResult = await buildPayrollAssurance(run.id);
  const findings = assuranceResult?.assurance.findings ?? [];
  const blockers = findings.filter((finding) => finding.blocking);
  const missingAttendance = findings.filter((finding) => finding.code === "MISSING_ATTENDANCE");
  const statutoryReview = findings.filter((finding) => finding.code === "MISSING_STATUTORY");
  const missingBank = findings.filter((finding) => finding.code === "MISSING_BANK_DETAILS");

  const expectedEntries = Number(run.employeeCount);
  const calculationComplete =
    rows.length > 0 &&
    expectedEntries > 0 &&
    rows.length === expectedEntries &&
    Number(run.totalChunks ?? 0) > 0 &&
    Number(run.processedChunks ?? 0) >= Number(run.totalChunks ?? 0) &&
    !["Draft","Queued","Processing","Recalculating","Failed"].includes(run.status);

  const inputsComplete = rows.length > 0 && rows.every(({employee}) =>
    Boolean(employee.employeeNo?.trim()) && Number(employee.basicRate) > 0 && Boolean(employee.startDate)
  );
  const attendancePassed = missingAttendance.length === 0 || Boolean(options.acknowledgeExceptions);
  const bankPassed = Boolean(options.allowRedactedDemoPayout) || (rows.length > 0 && missingBank.length === 0);
  const payslipPassed =
    rows.length > 0
    && payslipRows.length === rows.length
    && payslipRows.every((row) => Boolean(row.content?.trim()));
  const remittancePassed = overdueRemittances.length === 0;
  const statutoryPassed = statutoryReview.length === 0;
  const approvalPassed = approval?.status === "Approved";
  const nonBankBlockers = blockers.filter((finding) => finding.code !== "MISSING_BANK_DETAILS");
  const exceptionPassed = nonBankBlockers.length === 0 && (Number(run.exceptions) === 0 || Boolean(options.acknowledgeExceptions));

  const items: PayrollReleaseChecklistItem[] = [
    { key:"inputs", label:"Employee inputs", passed:inputsComplete, blocking:true, detail:inputsComplete ? `${rows.length} payroll employee record(s) have the required inputs.` : "One or more payroll employees are missing an employee number, valid basic rate, or start date." },
    { key:"attendance", label:"Attendance", passed:attendancePassed, blocking:true, acknowledgeable: missingAttendance.length > 0, detail:missingAttendance.length === 0 ? "No employee used the no-punch payroll fallback." : options.acknowledgeExceptions ? `${missingAttendance.length} attendance exception(s) were explicitly acknowledged.` : `${missingAttendance.length} employee(s) have no attendance in this cutoff and require review or acknowledgement.` },
    { key:"calculation", label:"Payroll calculation", passed:calculationComplete, blocking:true, detail:calculationComplete ? `${rows.length}/${expectedEntries} entries calculated and all chunks completed.` : `Calculation incomplete: ${rows.length}/${expectedEntries} entries, ${run.processedChunks ?? 0}/${run.totalChunks ?? 0} chunks.` },
    { key:"exceptions", label:"Exceptions", passed:exceptionPassed, blocking:true, acknowledgeable: nonBankBlockers.length === 0 && Number(run.exceptions) > 0, detail:exceptionPassed ? "No unresolved release-blocking payroll exception remains." : `${nonBankBlockers.length} blocking assurance finding(s) and/or ${run.exceptions} engine exception(s) still require action.` },
    { key:"statutory", label:"Statutory calculations", passed:statutoryPassed, blocking:true, detail:statutoryPassed ? "SSS, PhilHealth and Pag-IBIG treatment is present where compensation requires it." : `${statutoryReview.length} employee(s) need statutory treatment confirmation.` },
    { key:"payslips", label:"Employee payslips", passed:payslipPassed, blocking:true, detail:payslipPassed ? `${payslipRows.length}/${rows.length} employee payslip record(s) exist and contain payroll detail.` : `Payslip integrity failed: ${payslipRows.length}/${rows.length} calculated employee entries have stored payslips.` },
    { key:"remittance", label:"Prior contribution remittance", passed:remittancePassed, blocking:true, detail:remittancePassed ? "No overdue SSS, PhilHealth or Pag-IBIG remittance obligation is waiting for posting confirmation." : `${overdueRemittances.length} prior statutory remittance obligation(s) are overdue or missing deadline configuration and must be resolved before another payroll is released.` },
    { key:"approval", label:"Checker approval", passed:approvalPassed, blocking:true, detail:approvalPassed ? `Approved by ${approval?.decidedBy ?? approval?.approver ?? "the assigned checker"}.` : approval?.status === "Pending" ? `Waiting for ${approval.approver}.` : "No current approved checker task exists for this run." },
    { key:"bank", label:"Payout readiness", passed:bankPassed, blocking:true, detail: options.allowRedactedDemoPayout ? "Public sandbox payout destinations are intentionally redacted. Any generated bank file uses synthetic demo-only destinations and live disbursement remains disabled." : bankPassed ? "Every positive-net employee has complete payout details." : `${missingBank.length} positive-net employee(s) have incomplete bank details.` },
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
