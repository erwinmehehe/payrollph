import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  managedPayrollEngagements,
  managedPayrollGates,
  managedPayrollRunApprovals,
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

  const [approval] = await db.select().from(managedPayrollRunApprovals)
    .where(and(
      eq(managedPayrollRunApprovals.engagementId, engagement.id),
      eq(managedPayrollRunApprovals.payrollRunId, payrollRunId),
    ))
    .limit(1);

  return {
    required: true as const,
    engagement,
    approval: approval ?? null,
  };
}
