/**
 * Frozen, deterministic final-pay source evidence. Includes every source
 * field used for 13th month, annualized tax/statutory contributions, loan
 * settlement or employee/legal-employer eligibility. The arrays are sorted
 * without mutating the loader results because SQL has no implicit order.
 */
export type FinalPayFingerprintInputs = {
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
  loans: Array<{
    id: number; loanType: string; totalPaid: string | number;
    remainingBalance: string | number; status: string;
  }>;
};

export function finalPaySourceFingerprint(sources: FinalPayFingerprintInputs) {
  return {
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
