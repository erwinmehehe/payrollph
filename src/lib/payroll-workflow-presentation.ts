import type { PayrollRun, Task } from "@/components/workspace/types";
import type { PayrollPayoutState } from "@/lib/payroll-payout-state";
import { isPreliminaryPayroll } from "@/lib/payroll-period-ui";
import { storedMoneyCentavos, verifiedPesosFromCentavos } from "@/lib/stored-money-centavos";

export const PAYROLL_WORKFLOW_STAGES = [
  { key: "prepare", label: "Prepare", detail: "Calculate and validate inputs" },
  { key: "review", label: "Review", detail: "Resolve register exceptions" },
  { key: "approve", label: "Approve", detail: "Independent checker decision" },
  { key: "release", label: "Release", detail: "Lock register and payslips" },
  { key: "payout", label: "Bank payout", detail: "Submit and reconcile payments" },
] as const;

export type PayrollStageKey = typeof PAYROLL_WORKFLOW_STAGES[number]["key"];
export type PayrollPresentationState = "done" | "current" | "waiting";

type Checklist = ReadonlyArray<{
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
}> | null;

export function payrollRunPresentation(input: {
  run: PayrollRun;
  approvalTask?: Task | null;
  payout: PayrollPayoutState;
  checklist: Checklist;
  now?: Date;
}) {
  const { run, approvalTask, payout, checklist } = input;
  const released = run.status === "Released";
  const processing = ["Queued", "Processing", "Recalculating", "Releasing"].includes(run.status);
  const failed = run.status === "Failed";
  // A visually plausible payroll number must be proven to represent exact
  // stored centavos. Do not let Number() coerce 1e3, whitespace, sub-centavos,
  // null or unsafe amounts into an apparent completed payroll register.
  const grossCents = storedMoneyCentavos(run.grossPay);
  const netCents = storedMoneyCentavos(run.netPay);
  const deductionCents = grossCents !== null && netCents !== null
    ? grossCents - netCents : null;
  const calculated = !failed &&
    grossCents !== null && grossCents > 0 &&
    netCents !== null &&
    deductionCents !== null && Number.isSafeInteger(deductionCents) &&
    verifiedPesosFromCentavos(deductionCents) !== null;
  const approvalPending = approvalTask?.status === "Pending";
  const approved = approvalTask?.status === "Approved";
  // A dated pay period that has not yet ended must not be described as final.
  const preliminary = !released && isPreliminaryPayroll(run.periodEnd, calculated, input.now);
  const readyForRelease = run.status === "Ready for release" && approved && calculated;
  const blockers = checklist == null ? null : checklist.filter(
    (item) => item.blocking && !item.passed && !item.acknowledgeable,
  ).length;
  const reviewsToAcknowledge = checklist == null ? null : checklist.filter(
    (item) => item.blocking && !item.passed && item.acknowledgeable,
  ).length;

  const payoutState = released ? payout.payout.status : null;
  const completedPayout = released && payoutState === "completed";
  const index = completedPayout ? 5 :
    released ? 4 :
    readyForRelease ? 3 :
    approvalPending ? 2 :
    calculated ? 1 : 0;
  const currentStage = index === 5 ? "payout" : PAYROLL_WORKFLOW_STAGES[index].key;
  const stages = PAYROLL_WORKFLOW_STAGES.map((stage, i) => ({
    ...stage,
    state: (i < index || index === 5 ? "done" : i === index ? "current" : "waiting") as PayrollPresentationState,
  }));

  const message =
    failed ? "Calculation failed. Retry in the existing payroll controls before any review."
    : processing ? "Payroll is processing. Decisions and release remain subject to server checks."
    : released && completedPayout ? "Bank payout is recorded as completed. Check reconciliation evidence for any exceptions."
    : released && payoutState === "submitted" ? "Payment submitted to the payout provider. Do not assume employees have been paid until completion is confirmed."
    : released && payoutState === "ready" ? "Payroll is released. Complete bank payout preflight and submit payment separately."
    : released ? "Payroll is released; bank payout has not been confirmed. Use the payout workflow to continue."
    : readyForRelease && blockers !== null && blockers > 0 ? "Checker approved the run, but server release checks still have blocking issues."
    : readyForRelease ? "Independent approval was recorded. Check release gates before locking payroll."
    : approvalPending ? "Awaiting a separate checker's recorded decision. Payroll is not yet released."
    : approvalTask?.status === "Declined" ? "Checker returned this run. Resolve the findings and submit the corrected payroll for review."
    : run.status === "Ready for release" && !calculated ? "Stored payroll amounts could not be verified. Review and recalculate before release."
    : preliminary ? "This pay period is still open. Verify time entries and recalculate after cutoff."
    : calculated ? "Review the stored register, exceptions and assurance findings before requesting a checker."
    : "Prepare the pay-period inputs and calculate the register before review.";

  return {
    stages,
    currentStage,
    calculated,
    processing,
    released,
    preliminary,
    blockerCount: blockers,
    acknowledgementCount: reviewsToAcknowledge,
    exceptionCount: Math.max(0, run.exceptions),
    grossPay: calculated ? verifiedPesosFromCentavos(grossCents!) : null,
    netPay: calculated ? verifiedPesosFromCentavos(netCents!) : null,
    employeeDeductions: calculated ? verifiedPesosFromCentavos(Math.max(0, deductionCents!)) : null,
    payoutState,
    payoutLabel: released ? payout.payout.label : "Not available before payroll release",
    message,
  };
}
