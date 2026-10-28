import { createHash } from "node:crypto";

export type GovernmentLoanAgency = "SSS" | "Pag-IBIG";

type PayrollEntry = {
  employeeId: number;
  lineItems: unknown;
};

type LoanIdentity = {
  id: number;
  employeeId: number;
  employeeNo: string;
  loanType: string;
  referenceNo: string;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A PostgreSQL numeric(12,2) remittance value must be finite, positive and
 * centavo-exact; allow only tiny JS representation noise on valid decimals.
 */
function validRemittanceAmount(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const scaled = value * 100;
  const centavos = Math.round(scaled);
  return Number.isSafeInteger(centavos) && centavos > 0 &&
    centavos <= 999_999_999_999 && Math.abs(scaled - centavos) <= 1e-7;
}

export function governmentLoanAgency(loanType: string): GovernmentLoanAgency | null {
  const value = loanType.toLowerCase();
  if (value.includes("sss")) return "SSS";
  if (value.includes("pag-ibig") || value.includes("pagibig") || value.includes("hdmf")) return "Pag-IBIG";
  return null;
}

export function governmentLoanRemittanceDueDate(
  agency: GovernmentLoanAgency,
  applicableMonth: string,
) {
  // Date.UTC silently rolls months 00/13 and maps years 00-99 to 1900-1999.
  if ((agency !== "SSS" && agency !== "Pag-IBIG") ||
      typeof applicableMonth !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(applicableMonth) ||
      Number(applicableMonth.slice(0, 4)) < 100) {
    throw new Error("Valid agency and applicableMonth (YYYY-MM) are required.");
  }
  const [year, month] = applicableMonth.split("-").map(Number);
  const dueDate = agency === "Pag-IBIG"
    ? new Date(Date.UTC(year, month, 15)).toISOString()
    : new Date(Date.UTC(year, month + 1, 0)).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(dueDate)) {
    throw new Error("Agency remittance due date exceeds the supported calendar.");
  }
  return dueDate.slice(0, 10);
}

export function buildGovernmentLoanRemittanceSnapshot(input: {
  agency: GovernmentLoanAgency;
  applicableMonth: string;
  entries: PayrollEntry[];
  loans: LoanIdentity[];
}) {
  const loanById = new Map(input.loans.map((loan) => [loan.id, loan]));
  const amounts = new Map<number, number>();

  for (const entry of input.entries) {
    if (!Array.isArray(entry.lineItems)) continue;
    for (const item of entry.lineItems) {
      if (!item || typeof item !== "object") continue;
      const code = String((item as { code?: unknown }).code ?? "");
      const match = /^LOAN-(\d+)$/.exec(code);
      if (!match) continue;
      const loanId = Number(match[1]);
      const loan = loanById.get(loanId);
      if (!loan || loan.employeeId !== entry.employeeId) continue;
      if (governmentLoanAgency(loan.loanType) !== input.agency) continue;
      const amount = Math.abs(Number((item as { amount?: unknown }).amount ?? 0) || 0);
      if (amount <= 0) continue;
      amounts.set(loanId, round2((amounts.get(loanId) ?? 0) + amount));
    }
  }

  const members = [...amounts.entries()]
    .map(([loanId, deductedAmount]) => {
      const loan = loanById.get(loanId);
      if (!loan) throw new Error(`Loan #${loanId} is missing from loan identity data.`);
      return {
        loanId,
        employeeId: loan.employeeId,
        employeeNo: loan.employeeNo,
        loanType: loan.loanType,
        loanReferenceNo: loan.referenceNo,
        deductedAmount,
      };
    })
    .sort((a, b) => a.employeeId - b.employeeId || a.loanId - b.loanId);

  const expectedTotal = round2(members.reduce((sum, row) => sum + row.deductedAmount, 0));
  const employeeCount = new Set(members.map((row) => row.employeeId)).size;
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify({
      agency: input.agency,
      applicableMonth: input.applicableMonth,
      members,
    }))
    .digest("hex");

  return {
    members,
    employeeCount,
    loanCount: members.length,
    expectedTotal,
    snapshotHash,
  };
}

export function canRecordGovernmentLoanRemittance(input: {
  expectedTotal: number;
  amountPaid: number;
  paymentReference: string;
  agencyAcknowledgementReference: string;
  paymentVarianceNote?: string;
}) {
  if (!validRemittanceAmount(input.expectedTotal) ||
      !validRemittanceAmount(input.amountPaid)) {
    return { ok: false as const, error: "Expected and paid amounts must be positive, finite and centavo-exact." };
  }
  // Compare integer centavos after the input guard. Binary floats can turn
  // a lawful one-cent boundary into 0.010000000000005 and falsely reject it.
  const expectedCents = Math.round(input.expectedTotal * 100);
  const paidCents = Math.round(input.amountPaid * 100);
  if (paidCents + 1 < expectedCents) {
    return { ok: false as const, error: "Paid amount cannot be lower than the payroll-deducted government loan total." };
  }
  if (paidCents > expectedCents + 1 && String(input.paymentVarianceNote ?? "").trim().length < 4) {
    return { ok: false as const, error: "Explain any amount above payroll deductions, such as penalties or interest." };
  }
  if (input.paymentReference.trim().length < 4) {
    return { ok: false as const, error: "Payment reference is required." };
  }
  if (input.agencyAcknowledgementReference.trim().length < 4) {
    return { ok: false as const, error: "Agency acknowledgement reference is required." };
  }
  return { ok: true as const };
}

export function canConfirmGovernmentLoanPosting(input: {
  expectedAmount: number;
  postedAmount: number;
  postingReference: string;
}) {
  if (!validRemittanceAmount(input.expectedAmount) ||
      !validRemittanceAmount(input.postedAmount)) {
    return { ok: false as const, error: "Expected and posted amounts must be positive, finite and centavo-exact." };
  }
  const expectedCents = Math.round(input.expectedAmount * 100);
  const postedCents = Math.round(input.postedAmount * 100);
  if (Math.abs(expectedCents - postedCents) > 1) {
    return { ok: false as const, error: "Posted amount must match the payroll-deducted loan amount for this employee loan." };
  }
  if (input.postingReference.trim().length < 4) {
    return { ok: false as const, error: "Agency posting reference is required." };
  }
  return { ok: true as const };
}
