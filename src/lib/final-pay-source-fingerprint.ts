import type { SeparationLeaveSources } from "@/lib/separation-leave";
import { reviewFinalPayLoans } from "@/lib/final-pay-loan-authority";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
/**
 * Frozen, deterministic final-pay source evidence. Includes every source
 * field used for 13th month, annualized tax/statutory contributions, loan
 * settlement or employee/legal-employer eligibility. The arrays are sorted
 * without mutating the loader results because SQL has no implicit order.
 */
export type FinalPayFingerprintInputs = {
  leave?: SeparationLeaveSources;
  employee: {
    status: string; basicRate: string | number; mwe: boolean;
    orgUnitId: number | null; legalEntityId: number | null;
    employmentType: string; startDate: string;
  };
  payProfile: {
    id: number; payBasis: string; rateAmount: string | number;
    standardWorkDaysPerMonth: string | number;
    standardHoursPerDay: string | number; updatedAt: Date | string | null;
  };
  released: Array<{
    runId: number; entryId: number; grossPay: string | number;
    periodStart: string; periodEnd: string; payDate: string;
    lineItems: unknown; trace: unknown;
  }>;
  historical: Array<{
    id: number; grossPay: string | number; basicSalary: string | number | null;
    thirteenthMonth: string | number; taxWithheld: string | number;
    sssEmployee: string | number; philHealthEmployee: string | number;
    pagIbigEmployee: string | number; payDate: string;
  }>;
  retroSourcePeriods?: Array<{
    id: number; sourcePeriodStart: string | null; sourcePeriodEnd: string | null;
  }>;
  loans: Array<{
    id: number; loanType: string; totalPaid: string | number;
    remainingBalance: string | number; status: string;
    requestedByUserId?: number | null;
    reviewedByUserId?: number | null;
    reviewedAt?: Date | string | null;
    deductionAuthorizationReference?: string | null;
    reviewEvidenceReference?: string | null;
  }>;
};

export function finalPaySourceFingerprint(sources: FinalPayFingerprintInputs) {
  return {
    ...(criticalReleaseFlagEnabled("exactThirteenthCentavos") ? { thirteenthRoundingPolicy: "centavo-half-up-v1" } : {}),
    leave: sources.leave ? {
      balances: [...sources.leave.balances].sort((a, b) => a.id - b.id),
      policies: [...sources.leave.policies].sort((a, b) => a.id - b.id),
      conversions: [...sources.leave.conversions].sort((a, b) => a.id - b.id),
    } : null,
    employeeStatus: sources.employee.status,
    employeeBasicRate: Number(sources.employee.basicRate),
    employeeMwe: sources.employee.mwe,
    employeeOrgUnitId: sources.employee.orgUnitId,
    employeeLegalEntityId: sources.employee.legalEntityId,
    employeeEmploymentType: sources.employee.employmentType,
    employeeStartDate: String(sources.employee.startDate),
    payProfile: {
      id: sources.payProfile.id,
      payBasis: sources.payProfile.payBasis,
      rateAmount: Number(sources.payProfile.rateAmount),
      standardWorkDaysPerMonth: Number(sources.payProfile.standardWorkDaysPerMonth),
      standardHoursPerDay: Number(sources.payProfile.standardHoursPerDay),
      updatedAt: sources.payProfile.updatedAt instanceof Date
        ? sources.payProfile.updatedAt.toISOString()
        : String(sources.payProfile.updatedAt),
    },
    released: [...sources.released]
      .sort((a, b) => a.runId - b.runId || a.entryId - b.entryId)
      .map((row) => ({
        runId: row.runId,
        entryId: row.entryId,
        grossPay: Number(row.grossPay),
        periodStart: String(row.periodStart),
        periodEnd: String(row.periodEnd),
        payDate: String(row.payDate),
        lineItems: row.lineItems,
        trace: row.trace,
      })),
    historical: [...sources.historical]
      .sort((a, b) => a.id - b.id)
      .map((row) => ({
        id: row.id,
        grossPay: Number(row.grossPay),
        basicSalary: row.basicSalary == null ? null : Number(row.basicSalary),
        thirteenthMonth: Number(row.thirteenthMonth),
        taxWithheld: Number(row.taxWithheld),
        sssEmployee: Number(row.sssEmployee),
        philHealthEmployee: Number(row.philHealthEmployee),
        pagIbigEmployee: Number(row.pagIbigEmployee),
        payDate: String(row.payDate),
      })),
    // A changed source period must invalidate a final-pay maker/checker
    // approval even when the already-released RETRO payslip stays unchanged.
    retroSourcePeriods: [...(sources.retroSourcePeriods ?? [])]
      .sort((a, b) => a.id - b.id)
      .map((row) => ({
        id: row.id,
        sourcePeriodStart: row.sourcePeriodStart === null ? null : String(row.sourcePeriodStart),
        sourcePeriodEnd: row.sourcePeriodEnd === null ? null : String(row.sourcePeriodEnd),
      })),
    // Comparisons detect changes to loan deduction review evidence without
    // disclosing private external document references in the stored snapshot.
    loanAuthorityEvidenceDigest: reviewFinalPayLoans(sources.loans).evidenceDigest,
    loans: [...sources.loans]
      .sort((a, b) => a.id - b.id)
      .map((loan) => ({
        id: loan.id,
        loanType: loan.loanType,
        totalPaid: Number(loan.totalPaid),
        remainingBalance: Number(loan.remainingBalance),
        status: loan.status,
      })),
  };
}

/**
 * Initiation computes payroll from the worker's pre-transition source state,
 * then commits status = Separating in the same operation. Frozen evidence for
 * subsequent Finance approval must describe that authorized post-transition
 * status, not the now-obsolete Active/On leave status.
 *
 * This never turns an unrelated status into permission: the caller still
 * checks the pre-transition source under its transaction lock.
 */
export function expectedFinalPaySourceAfterInitiation(
  source: ReturnType<typeof finalPaySourceFingerprint>,
) {
  return { ...source, employeeStatus: "Separating" as const };
}

/** JSONB preserves values and array order, but not object property order. */
export function sameFinalPaySource(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object"
    || Array.isArray(left) || Array.isArray(right)) return false;
  const canonical = (value: unknown) => JSON.stringify(value, (_key, nested: unknown) => {
    // JSON.stringify normalizes Date via toJSON before calling this replacer,
    // matching timestamps read back from JSONB without dropping their value.
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
    }
    return nested;
  });
  return canonical(left) === canonical(right);
}
