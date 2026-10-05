import { createHash } from "node:crypto";
import { NATIONAL_HOLIDAYS_2026 } from "@/lib/wage-orders";

export type StatutoryAgency = "SSS" | "PhilHealth" | "Pag-IBIG";

type Entry = {
  employeeId: number;
  lineItems: unknown;
  trace: unknown;
};

type EmployeeIdentity = {
  id: number;
  employeeNo: string;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function traceInputNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof raw === "string" ? Number(raw.slice(prefix.length)) || 0 : 0;
}

function deduction(lineItems: unknown, codes: string[]) {
  if (!Array.isArray(lineItems)) return 0;
  return round2(lineItems
    .filter((item) => item && typeof item === "object" && codes.includes(String((item as { code?: unknown }).code ?? "").toUpperCase()))
    .reduce((sum, item) => sum + Math.abs(Number((item as { amount?: unknown }).amount ?? 0) || 0), 0));
}

export function statutorySharesForEntry(entry: Entry, agency: StatutoryAgency) {
  if (agency === "SSS") {
    return {
      employeeShare: deduction(entry.lineItems, ["SSS"]),
      employerShare: round2(
        traceInputNumber(entry.trace, "sssEmployerCutoff")
        + traceInputNumber(entry.trace, "sssEmployerEcCutoff"),
      ),
    };
  }
  if (agency === "PhilHealth") {
    return {
      employeeShare: deduction(entry.lineItems, ["PHIC"]),
      employerShare: round2(traceInputNumber(entry.trace, "philHealthEmployerCutoff")),
    };
  }
  return {
    employeeShare: deduction(entry.lineItems, ["HDMF", "HDMF_VOL"]),
    employerShare: round2(traceInputNumber(entry.trace, "pagIbigEmployerCutoff")),
  };
}

export function statutoryRemittanceSnapshotHash(input: {
  agency: StatutoryAgency;
  applicableMonth: string;
  members: Array<{
    employeeId: number;
    employeeNo: string;
    employeeShare: number;
    employerShare: number;
    totalContribution: number;
  }>;
}) {
  const members = [...input.members]
    .map((member) => ({
      employeeId: member.employeeId,
      employeeNo: member.employeeNo,
      employeeShare: round2(member.employeeShare),
      employerShare: round2(member.employerShare),
      totalContribution: round2(member.totalContribution),
    }))
    .sort((a, b) => a.employeeId - b.employeeId);
  return createHash("sha256")
    .update(JSON.stringify({
      agency: input.agency,
      applicableMonth: input.applicableMonth,
      members,
    }))
    .digest("hex");
}

export function buildStatutoryRemittanceSnapshot(input: {
  agency: StatutoryAgency;
  applicableMonth: string;
  entries: Entry[];
  employees: EmployeeIdentity[];
}) {
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const byEmployee = new Map<number, { employeeShare: number; employerShare: number }>();

  for (const entry of input.entries) {
    const shares = statutorySharesForEntry(entry, input.agency);
    const current = byEmployee.get(entry.employeeId) ?? { employeeShare: 0, employerShare: 0 };
    current.employeeShare = round2(current.employeeShare + shares.employeeShare);
    current.employerShare = round2(current.employerShare + shares.employerShare);
    byEmployee.set(entry.employeeId, current);
  }

  const members = [...byEmployee.entries()]
    .map(([employeeId, shares]) => {
      const employee = employeeById.get(employeeId);
      if (!employee) throw new Error(`Employee #${employeeId} is missing from remittance identity data.`);
      return {
        employeeId,
        employeeNo: employee.employeeNo,
        employeeShare: shares.employeeShare,
        employerShare: shares.employerShare,
        totalContribution: round2(shares.employeeShare + shares.employerShare),
      };
    })
    .filter((row) => row.totalContribution > 0)
    .sort((a, b) => a.employeeId - b.employeeId);

  const expectedEmployeeShare = round2(members.reduce((sum, row) => sum + row.employeeShare, 0));
  const expectedEmployerShare = round2(members.reduce((sum, row) => sum + row.employerShare, 0));
  const expectedTotal = round2(expectedEmployeeShare + expectedEmployerShare);
  const snapshotHash = statutoryRemittanceSnapshotHash({
    agency: input.agency,
    applicableMonth: input.applicableMonth,
    members,
  });

  return {
    members,
    employeeCount: members.length,
    expectedEmployeeShare,
    expectedEmployerShare,
    expectedTotal,
    snapshotHash,
  };
}

function lastDayOfNextMonth(applicableMonth: string) {
  const [year, month] = applicableMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

function dateInNextMonth(applicableMonth: string, day: number) {
  const [year, month] = applicableMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function nominalRemittanceDueDate(input: {
  agency: StatutoryAgency;
  applicableMonth: string;
  legalName: string;
  philHealthEmployerNo?: string | null;
}) {
  if (!/^\d{4}-\d{2}$/.test(input.applicableMonth)) {
    throw new Error("applicableMonth must use YYYY-MM.");
  }
  if (input.agency === "SSS") return lastDayOfNextMonth(input.applicableMonth);

  if (input.agency === "PhilHealth") {
    const digits = String(input.philHealthEmployerNo ?? "").replace(/\D/g, "");
    const last = Number(digits.at(-1));
    if (!Number.isInteger(last)) {
      throw new Error("PhilHealth employer number is required to determine the remittance deadline.");
    }
    return dateInNextMonth(input.applicableMonth, last <= 4 ? 15 : 20);
  }

  const first = input.legalName.trim().charAt(0).toUpperCase();
  if (!first) throw new Error("Organization legal name is required to determine the Pag-IBIG deadline.");
  if (first >= "A" && first <= "D") return dateInNextMonth(input.applicableMonth, 14);
  if (first >= "E" && first <= "L") return dateInNextMonth(input.applicableMonth, 19);
  if (first >= "M" && first <= "Q") return dateInNextMonth(input.applicableMonth, 24);
  return lastDayOfNextMonth(input.applicableMonth);
}

const NATIONAL_NON_WORKING_DATES_2026 = new Set(
  NATIONAL_HOLIDAYS_2026.map((holiday) => holiday.date),
);

export function nextWorkingDay(
  dateText: string,
  holidayDates: ReadonlySet<string> = NATIONAL_NON_WORKING_DATES_2026,
) {
  let cursor = new Date(`${dateText}T00:00:00Z`);
  for (let guard = 0; guard < 14; guard += 1) {
    const current = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !holidayDates.has(current)) {
      return current;
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  throw new Error("Could not resolve the next working day within 14 days.");
}

export function effectiveRemittanceDueDate(input: {
  agency: StatutoryAgency;
  applicableMonth: string;
  legalName: string;
  philHealthEmployerNo?: string | null;
}) {
  const nominal = nominalRemittanceDueDate(input);
  if (input.agency === "Pag-IBIG") return nominal;
  return nextWorkingDay(nominal);
}

export function canConfirmMemberPosting(input: {
  expectedTotal: number;
  postedAmount: number;
  postingReference: string;
}) {
  const expected = round2(input.expectedTotal);
  const posted = round2(input.postedAmount);
  if (!Number.isFinite(posted) || posted < 0) {
    return { ok: false as const, error: "Posted amount must be a valid non-negative number." };
  }
  if (Math.abs(expected - posted) > 0.01) {
    return {
      ok: false as const,
      error: "Agency-posted amount must match the employee's expected contribution. Record a posting exception instead.",
    };
  }
  if (input.postingReference.trim().length < 4) {
    return { ok: false as const, error: "Agency posting reference is required." };
  }
  return { ok: true as const };
}

export function canMarkRemittancePaid(input: {
  expectedTotal: number;
  amountPaid: number;
  paymentReference: string;
  agencyReceiptReference: string;
  paymentVarianceNote?: string;
}) {
  const expected = round2(input.expectedTotal);
  const paid = round2(input.amountPaid);
  if (paid + 0.01 < expected) {
    return { ok: false as const, error: "Paid amount cannot be lower than the expected statutory remittance liability." };
  }
  if (paid > expected + 0.01 && String(input.paymentVarianceNote ?? "").trim().length < 4) {
    return { ok: false as const, error: "Explain any payment above the contribution liability, such as agency penalties or interest." };
  }
  if (input.paymentReference.trim().length < 4) {
    return { ok: false as const, error: "Payment reference is required." };
  }
  if (input.agencyReceiptReference.trim().length < 4) {
    return { ok: false as const, error: "Agency receipt or acknowledgement reference is required." };
  }
  return { ok: true as const };
}
