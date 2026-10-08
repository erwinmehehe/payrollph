import { managedPayrollRunFingerprint } from "@/lib/managed-payroll";

export type PayrollApprovalRunSnapshot = {
  id: number;
  grossPay: string | number;
  netPay: string | number;
  employeeCount: number;
};

export type PayrollApprovalTaskSnapshot = {
  payrollRunId: number | null;
  payrollFingerprint: string | null;
  payrollGross: string | number | null;
  payrollNet: string | number | null;
  payrollEmployeeCount: number | null;
};

export function payrollApprovalSnapshotMatches(
  run: PayrollApprovalRunSnapshot,
  task: PayrollApprovalTaskSnapshot,
  currentFingerprint: string,
) {
  return (
    task.payrollRunId === run.id
    && Boolean(task.payrollFingerprint)
    && task.payrollFingerprint === currentFingerprint
    && Number(task.payrollGross) === Number(run.grossPay)
    && Number(task.payrollNet) === Number(run.netPay)
    && Number(task.payrollEmployeeCount) === Number(run.employeeCount)
  );
}

export async function verifyPayrollApprovalSnapshot(
  run: PayrollApprovalRunSnapshot,
  task: PayrollApprovalTaskSnapshot,
) {
  const currentFingerprint = await managedPayrollRunFingerprint(run.id);
  return {
    valid: payrollApprovalSnapshotMatches(run, task, currentFingerprint),
    currentFingerprint,
  };
}
