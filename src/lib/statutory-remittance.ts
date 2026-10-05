export const STATUTORY_REMITTANCE_AGENCIES = ["SSS", "PhilHealth", "Pag-IBIG"] as const;
export type StatutoryRemittanceAgency = (typeof STATUTORY_REMITTANCE_AGENCIES)[number];

type PayrollContributionEntry = {
  employeeId: number;
  payrollRunId: number;
  lineItems: unknown;
  trace: unknown;
};

export type StatutoryRemittanceTotal = {
  agency: StatutoryRemittanceAgency;
  employeeAmount: number;
  employerAmount: number;
  totalAmount: number;
  employeeCount: number;
  sourcePayrollRunIds: number[];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lineAmount(lineItems: unknown, codes: string[]) {
  if (!Array.isArray(lineItems)) return 0;
  return roundMoney(lineItems.reduce((sum, raw) => {
    if (!raw || typeof raw !== "object") return sum;
    const row = raw as Record<string, unknown>;
    if (!codes.includes(String(row.code ?? ""))) return sum;
    const amount = Number(row.amount ?? 0);
    return sum + (Number.isFinite(amount) ? Math.abs(amount) : 0);
  }, 0));
}

export function traceInputNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  const value = typeof raw === "string" ? Number(raw.slice(prefix.length)) : 0;
  return Number.isFinite(value) ? value : 0;
}

export function statutoryRemittanceTotals(
  entries: PayrollContributionEntry[],
): StatutoryRemittanceTotal[] {
  const employeeSets = new Map<StatutoryRemittanceAgency, Set<number>>([
    ["SSS", new Set()],
    ["PhilHealth", new Set()],
    ["Pag-IBIG", new Set()],
  ]);
  const runIds = new Set(entries.map((entry) => entry.payrollRunId));

  let sssEmployee = 0;
  let sssEmployer = 0;
  let phEmployee = 0;
  let phEmployer = 0;
  let pagIbigEmployee = 0;
  let pagIbigEmployer = 0;

  for (const entry of entries) {
    const sss = lineAmount(entry.lineItems, ["SSS"]);
    const ph = lineAmount(entry.lineItems, ["PHIC"]);
    const pagIbig = lineAmount(entry.lineItems, ["HDMF", "HDMF_VOL"]);

    sssEmployee += sss;
    phEmployee += ph;
    pagIbigEmployee += pagIbig;

    sssEmployer +=
      traceInputNumber(entry.trace, "sssEmployerCutoff")
      + traceInputNumber(entry.trace, "sssEmployerEcCutoff");
    phEmployer += traceInputNumber(entry.trace, "philHealthEmployerCutoff");
    pagIbigEmployer += traceInputNumber(entry.trace, "pagIbigEmployerCutoff");

    if (sss > 0 || traceInputNumber(entry.trace, "sssEmployerCutoff") > 0) {
      employeeSets.get("SSS")!.add(entry.employeeId);
    }
    if (ph > 0 || traceInputNumber(entry.trace, "philHealthEmployerCutoff") > 0) {
      employeeSets.get("PhilHealth")!.add(entry.employeeId);
    }
    if (pagIbig > 0 || traceInputNumber(entry.trace, "pagIbigEmployerCutoff") > 0) {
      employeeSets.get("Pag-IBIG")!.add(entry.employeeId);
    }
  }

  const build = (
    agency: StatutoryRemittanceAgency,
    employeeAmount: number,
    employerAmount: number,
  ): StatutoryRemittanceTotal => {
    const employee = roundMoney(employeeAmount);
    const employer = roundMoney(employerAmount);
    return {
      agency,
      employeeAmount: employee,
      employerAmount: employer,
      totalAmount: roundMoney(employee + employer),
      employeeCount: employeeSets.get(agency)!.size,
      sourcePayrollRunIds: [...runIds].sort((a, b) => a - b),
    };
  };

  return [
    build("SSS", sssEmployee, sssEmployer),
    build("PhilHealth", phEmployee, phEmployer),
    build("Pag-IBIG", pagIbigEmployee, pagIbigEmployer),
  ];
}

function daysInMonth(year: number, monthOneBased: number) {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

function followingMonth(applicableMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(applicableMonth)) {
    throw new Error("Applicable month must use YYYY-MM.");
  }
  const [year, month] = applicableMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
  };
}

function dateText(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDigit(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits.at(-1)) : null;
}

export function statutoryRemittanceDeadline(input: {
  agency: StatutoryRemittanceAgency;
  applicableMonth: string;
  philHealthEmployerNo?: string | null;
  employerName?: string | null;
}) {
  const next = followingMonth(input.applicableMonth);

  if (input.agency === "SSS") {
    return {
      dueDate: dateText(next.year, next.month, daysInMonth(next.year, next.month)),
      dueRule: "Regular employer: last day of the month following the applicable month; SSS non-working-day extensions must be checked against the actual calendar.",
    };
  }

  if (input.agency === "PhilHealth") {
    const penLastDigit = lastDigit(input.philHealthEmployerNo);
    if (penLastDigit == null) {
      return {
        dueDate: null,
        dueRule: "PhilHealth PEN is missing, so the 11th-15th vs 16th-20th employer remittance window cannot be resolved.",
      };
    }
    const dueDay = penLastDigit <= 4 ? 15 : 20;
    return {
      dueDate: dateText(next.year, next.month, dueDay),
      dueRule: penLastDigit <= 4
        ? "PhilHealth employer PEN ending 0-4: remit within the 11th-15th of the following month."
        : "PhilHealth employer PEN ending 5-9: remit within the 16th-20th of the following month.",
    };
  }

  const first = String(input.employerName ?? "").trim().toUpperCase().charAt(0);
  let dueDay: number | null = null;
  let window = "";
  if (/[A-D]/.test(first)) {
    dueDay = 14;
    window = "10th-14th";
  } else if (/[E-L]/.test(first)) {
    dueDay = 19;
    window = "15th-19th";
  } else if (/[M-Q]/.test(first)) {
    dueDay = 24;
    window = "20th-24th";
  } else if (/[R-Z0-9]/.test(first)) {
    dueDay = daysInMonth(next.year, next.month);
    window = "25th-end of month";
  }

  return dueDay == null
    ? {
        dueDate: null,
        dueRule: "Employer legal name is missing or unsupported, so the Pag-IBIG remittance schedule cannot be resolved.",
      }
    : {
        dueDate: dateText(next.year, next.month, dueDay),
        dueRule: `Pag-IBIG employer-name schedule (${first}): ${window} of the month following the period covered.`,
      };
}

export function remittanceAmountMatches(expected: number, paid: number) {
  return Math.abs(roundMoney(expected) - roundMoney(paid)) < 0.01;
}

export function remittanceIsOverdue(input: {
  dueDate: string | null;
  status: string;
  today: string;
}) {
  return Boolean(
    input.dueDate
    && input.dueDate < input.today
    && input.status !== "confirmed",
  );
}
