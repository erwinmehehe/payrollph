import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, payrollEntries, payrollRuns } from "@/db/schema";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { verifyPayrollApprovalSnapshot } from "@/lib/payroll-approval-integrity";
import { connectedPayrollReleaseGateEnabled, safePayrollConnectedReleaseReadiness } from "@/lib/payroll-connected-release-gate-server";

export type PayrollReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "approval" | "bank" | "connected";
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

  const approvalRows = await db.select().from(approvalTasks).where(eq(approvalTasks.payrollRunId, run.id));
  const approval = approvalRows.sort((a,b) => b.id - a.id)[0] ?? null;
  const approvalSnapshotValid = approval?.status === "Approved"
    ? (await verifyPayrollApprovalSnapshot(run, approval)).valid
    : false;

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
  const statutoryPassed = statutoryReview.length === 0;
  const approvalPassed = approval?.status === "Approved" && approvalSnapshotValid;
  const nonBankBlockers = blockers.filter((finding) => finding.code !== "MISSING_BANK_DETAILS");
  const exceptionPassed = nonBankBlockers.length === 0 && (Number(run.exceptions) === 0 || Boolean(options.acknowledgeExceptions));

  const items: PayrollReleaseChecklistItem[] = [
    { key:"inputs", label:"Employee inputs", passed:inputsComplete, blocking:true, detail:inputsComplete ? `${rows.length} payroll employee record(s) have the required inputs.` : "One or more payroll employees are missing an employee number, valid basic rate, or start date." },
    { key:"attendance", label:"Attendance", passed:attendancePassed, blocking:true, acknowledgeable: missingAttendance.length > 0, detail:missingAttendance.length === 0 ? "No employee used the no-punch payroll fallback." : options.acknowledgeExceptions ? `${missingAttendance.length} attendance exception(s) were explicitly acknowledged.` : `${missingAttendance.length} employee(s) have no attendance in this cutoff and require review or acknowledgement.` },
    { key:"calculation", label:"Payroll calculation", passed:calculationComplete, blocking:true, detail:calculationComplete ? `${rows.length}/${expectedEntries} entries calculated and all chunks completed.` : `Calculation incomplete: ${rows.length}/${expectedEntries} entries, ${run.processedChunks ?? 0}/${run.totalChunks ?? 0} chunks.` },
    { key:"exceptions", label:"Exceptions", passed:exceptionPassed, blocking:true, acknowledgeable: nonBankBlockers.length === 0 && Number(run.exceptions) > 0, detail:exceptionPassed ? "No unresolved release-blocking payroll exception remains." : `${nonBankBlockers.length} blocking assurance finding(s) and/or ${run.exceptions} engine exception(s) still require action.` },
    { key:"statutory", label:"Statutory calculations", passed:statutoryPassed, blocking:true, detail:statutoryPassed ? "SSS, PhilHealth and Pag-IBIG treatment is present where compensation requires it." : `${statutoryReview.length} employee(s) need statutory treatment confirmation.` },
    { key:"approval", label:"Checker approval", passed:approvalPassed, blocking:true, detail:approvalPassed ? `Approved by ${approval?.decidedBy ?? approval?.approver ?? "the assigned checker"} for this exact payroll snapshot.` : approval?.status === "Approved" ? "Checker approval is stale because the payroll contents no longer match the approved snapshot." : approval?.status === "Pending" ? `Waiting for ${approval.approver}.` : "No current approved checker task exists for this run." },
    { key:"bank", label:"Payout readiness", passed:bankPassed, blocking:true, detail: options.allowRedactedDemoPayout ? "Public sandbox payout destinations are intentionally redacted. Any generated bank file uses synthetic demo-only destinations and live disbursement remains disabled." : bankPassed ? "Every positive-net employee has complete payout details." : `${missingBank.length} positive-net employee(s) have incomplete bank details.` },
  ];

  // Default OFF: existing release behavior is byte-for-byte equivalent.
  // Enabling the flag adds an independent, non-acknowledgeable blocker.
  if (connectedPayrollReleaseGateEnabled(run.organizationId)) {
    const upstream = await safePayrollConnectedReleaseReadiness(runId);
    items.push({
      key: "connected",
      label: "HRIS / WFM / HCM source integrity",
      passed: upstream.ready,
      blocking: true,
      detail: upstream.ready
        ? "Payroll population, latest completed calculation, and actionable upstream changes were reviewed. This is not independent payroll certification."
        : upstream.findings.length
          ? `${upstream.blockingCount} source-integrity blocker(s) and ${upstream.reviewCount} review item(s). Resolve upstream evidence, recalculate when required, and request fresh checker approval. ${upstream.findings[0].detail}`
          : "Connected payroll source integrity is not verified. Release is blocked.",
    });
  }

  return {
    run,
    approval,
    assurance: assuranceResult?.assurance ?? null,
    entryCount: rows.length,
    items,
    ready: items.filter((item) => item.blocking).every((item) => item.passed),
  };
}
