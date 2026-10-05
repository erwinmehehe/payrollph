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
  if (!/^\d{4}-\d{2}$/.test(applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  const [year, month] = applicableMonth.split("-").map(Number);
  if (agency === "Pag-IBIG") {
    return new Date(Date.UTC(year, month, 15)).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
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
  const expected = round2(input.expectedTotal);
  const paid = round2(input.amountPaid);
  if (paid + 0.01 < expected) {
    return { ok: false as const, error: "Paid amount cannot be lower than the payroll-deducted government loan total." };
  }
  if (paid > expected + 0.01 && String(input.paymentVarianceNote ?? "").trim().length < 4) {
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
  if (Math.abs(round2(input.expectedAmount) - round2(input.postedAmount)) > 0.01) {
    return { ok: false as const, error: "Posted amount must match the payroll-deducted loan amount for this employee loan." };
  }
  if (input.postingReference.trim().length < 4) {
    return { ok: false as const, error: "Agency posting reference is required." };
  }
  return { ok: true as const };
}
