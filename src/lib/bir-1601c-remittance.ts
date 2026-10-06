import { createHash } from "node:crypto";
import { taxWithheldFromLineItems } from "@/lib/exporters";

export type Bir1601CFilingChannel = "non_efps" | "efps";
export type BirEfpsGroup = "A" | "B" | "C" | "D" | "E";

function isoDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

export function bir1601cDeadlines(input: {
  applicableMonth: string;
  filingChannel: Bir1601CFilingChannel;
  efpsGroup?: BirEfpsGroup | null;
}) {
  if (!/^\d{4}-\d{2}$/.test(input.applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  const [year, month] = input.applicableMonth.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthIndex = month === 12 ? 0 : month;

  if (input.filingChannel === "non_efps") {
    const day = month === 12 ? 15 : 10;
    const due = isoDate(nextYear, nextMonthIndex, day);
    return { filingDueDate: due, paymentDueDate: due };
  }

  if (!input.efpsGroup || !["A", "B", "C", "D", "E"].includes(input.efpsGroup)) {
    throw new Error("eFPS Group A, B, C, D or E is required.");
  }
  const filingDayByGroup: Record<BirEfpsGroup, number> = {
    A: 15,
    B: 14,
    C: 13,
    D: 12,
    E: 11,
  };
  return {
    filingDueDate: isoDate(nextYear, nextMonthIndex, filingDayByGroup[input.efpsGroup]),
    paymentDueDate: isoDate(nextYear, nextMonthIndex, 15),
  };
}

export function buildBir1601cRemittanceSnapshot(input: {
  applicableMonth: string;
  entries: Array<{ employeeId: number; lineItems: unknown }>;
  payrollRunCount: number;
}) {
  if (!/^\d{4}-\d{2}$/.test(input.applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  const expectedTaxWithheld = Math.round(
    (input.entries.reduce((sum, entry) => sum + taxWithheldFromLineItems(entry.lineItems), 0) + Number.EPSILON) * 100,
  ) / 100;
  const employeeCount = new Set(input.entries.map((entry) => entry.employeeId)).size;
  const snapshotHash = createHash("sha256")
    .update(JSON.stringify({
      applicableMonth: input.applicableMonth,
      payrollRunCount: input.payrollRunCount,
      employeeCount,
      expectedTaxWithheld,
      rows: input.entries.map((entry) => ({
        employeeId: entry.employeeId,
        tax: taxWithheldFromLineItems(entry.lineItems),
      })),
    }))
    .digest("hex");

  return {
    employeeCount,
    payrollRunCount: input.payrollRunCount,
    expectedTaxWithheld,
    snapshotHash,
  };
}

export function compareBir1601cFiling(input: {
  expectedTaxWithheld: number;
  expectedEmployeeCount: number;
  reportedTotal: number | null;
  reportedEmployeeCount: number | null;
}) {
  const totalDifference = input.reportedTotal == null
    ? null
    : Math.round((input.reportedTotal - input.expectedTaxWithheld + Number.EPSILON) * 100) / 100;
  const employeeCountDifference = input.reportedEmployeeCount == null
    ? null
    : input.reportedEmployeeCount - input.expectedEmployeeCount;
  return {
    totalMatches: totalDifference != null && Math.abs(totalDifference) <= 0.01,
    employeeCountMatches: employeeCountDifference === 0,
    totalDifference,
    employeeCountDifference,
    matched:
      totalDifference != null
      && Math.abs(totalDifference) <= 0.01
      && employeeCountDifference === 0,
  };
}

export function canRecordBir1601cPayment(input: {
  expectedTaxWithheld: number;
  amountPaid: number;
  paymentReference: string;
  paymentVarianceNote?: string;
}) {
  const expected = Math.round((input.expectedTaxWithheld + Number.EPSILON) * 100) / 100;
  const paid = Math.round((input.amountPaid + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(paid) || paid < 0) {
    return { ok: false as const, error: "Payment amount must be a valid non-negative number." };
  }
  if (paid + 0.01 < expected) {
    return { ok: false as const, error: "BIR payment cannot be lower than the payroll-derived 1601-C withholding liability." };
  }
  if (paid > expected + 0.01 && String(input.paymentVarianceNote ?? "").trim().length < 4) {
    return { ok: false as const, error: "Explain any payment above the payroll withholding liability, such as surcharge, interest or compromise penalty." };
  }
  if (paid > 0 && input.paymentReference.trim().length < 4) {
    return { ok: false as const, error: "BIR payment confirmation/reference is required when tax is paid." };
  }
  return { ok: true as const };
}
