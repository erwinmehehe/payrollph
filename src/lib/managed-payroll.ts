import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  managedPayrollEngagements,
  managedPayrollGates,
  managedPayrollRunApprovals,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";

export const MANAGED_PAYROLL_GATES = [
  { key: "company-data", label: "Company and employee master data reconciled" },
  { key: "statutory-ids", label: "Employer and employee statutory identifiers reviewed" },
  { key: "payroll-policy", label: "Payroll calendar, cutoff and earning/deduction policies signed off" },
  { key: "parallel-run", label: "Parallel payroll independently reconciled" },
  { key: "bank-uat", label: "Payout route or bank-file UAT evidenced" },
  { key: "filing-workflow", label: "Government filing workflow rehearsed with evidence" },
  { key: "roles", label: "Processor, checker, client approver and release roles tested separately" },
  { key: "client-signoff", label: "Client implementation sign-off recorded" },
] as const;

export async function seedManagedPayrollGates(engagementId: number) {
  const existing = await db.select().from(managedPayrollGates)
    .where(eq(managedPayrollGates.engagementId, engagementId));
  const keys = new Set(existing.map((row) => row.gateKey));
  const missing = MANAGED_PAYROLL_GATES.filter((gate) => !keys.has(gate.key));
  if (missing.length > 0) {
    await db.insert(managedPayrollGates).values(missing.map((gate) => ({
      engagementId,
      gateKey: gate.key,
      label: gate.label,
    })));
  }
}

function canonicalizeManagedPayrollValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeManagedPayrollValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeManagedPayrollValue(nested)]),
    );
  }
  return value;
}

export async function managedPayrollRunFingerprint(payrollRunId: number) {
  const rows = await db.select({
    employeeId: payrollEntries.employeeId,
    grossPay: payrollEntries.grossPay,
    deductions: payrollEntries.deductions,
    netPay: payrollEntries.netPay,
    status: payrollEntries.status,
    lineItems: payrollEntries.lineItems,
    trace: payrollEntries.trace,
  }).from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, payrollRunId))
    .orderBy(asc(payrollEntries.employeeId));

  return createHash("sha256")
    .update(JSON.stringify(canonicalizeManagedPayrollValue(rows)))
    .digest("hex");
}

export function managedPayrollApprovalMatches(
  run: { grossPay: string; netPay: string; employeeCount: number },
  approval: {
    payrollFingerprint: string;
    approvedGross: string;
    approvedNet: string;
    approvedEmployeeCount: number;
  },
  currentFingerprint: string,
) {
  return (
    currentFingerprint === approval.payrollFingerprint
    && Number(run.grossPay) === Number(approval.approvedGross)
    && Number(run.netPay) === Number(approval.approvedNet)
    && Number(run.employeeCount) === Number(approval.approvedEmployeeCount)
  );
}

export async function managedPayrollReleaseRequirement(
  organizationId: number,
  payrollRunId: number,
) {
  const [engagement] = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, organizationId))
    .limit(1);
  if (!engagement || !["pilot", "live"].includes(engagement.status)) {
    return { required: false as const, engagement: null, approval: null };
  }

  const [[approval], [run], gates] = await Promise.all([
    db.select().from(managedPayrollRunApprovals)
      .where(and(
        eq(managedPayrollRunApprovals.engagementId, engagement.id),
        eq(managedPayrollRunApprovals.payrollRunId, payrollRunId),
      ))
      .limit(1),
    db.select().from(payrollRuns).where(eq(payrollRuns.id, payrollRunId)).limit(1),
    db.select().from(managedPayrollGates)
      .where(eq(managedPayrollGates.engagementId, engagement.id)),
  ]);
  const requiredGateKeys = new Set(MANAGED_PAYROLL_GATES.map((gate) => gate.key));
  const verifiedGateKeys = new Set(gates.filter((gate) => gate.status === "verified").map((gate) => gate.gateKey));
  const missingGateKeys = [...requiredGateKeys].filter((key) => !verifiedGateKeys.has(key));
  const gatesComplete = missingGateKeys.length === 0;
  const fingerprint = approval ? await managedPayrollRunFingerprint(payrollRunId) : null;
  const approvalValid = Boolean(
    approval
    && run
    && fingerprint
    && managedPayrollApprovalMatches(run, approval, fingerprint),
  );

  return {
    required: true as const,
    engagement,
    approval: approval ?? null,
    approvalValid,
    gatesComplete,
    missingGateKeys,
    currentFingerprint: fingerprint,
  };
}
