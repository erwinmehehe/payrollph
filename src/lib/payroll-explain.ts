export type ExplainPayEntryInput = {
  grossPay: string | number;
  deductions: string | number;
  netPay: string | number;
  lineItems?: unknown;
  trace?: unknown;
};

export type ExplainPayLine = {
  code: string;
  label: string;
  direction: "earning" | "deduction";
  previous: number | null;
  current: number;
  delta: number | null;
  netEffectDelta: number | null;
  reason: string;
  notes: string[];
};

export type ExplainPayModel = {
  currentGross: number;
  currentDeductions: number;
  currentNet: number;
  previousGross: number | null;
  previousDeductions: number | null;
  previousNet: number | null;
  netDelta: number | null;
  netPercent: number | null;
  ruleVersion: string | null;
  context: Record<string, string | number | null>;
  lines: ExplainPayLine[];
};

type StoredLine = { code: string; label: string; amount: number; notes: string[] };

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const numberOf = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const peso = (value: number) => `₱${cents(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function storedLines(entry: ExplainPayEntryInput): StoredLine[] {
  if (!Array.isArray(entry.lineItems)) return [];
  return entry.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    if (typeof row.amount !== "string" && typeof row.amount !== "number") return [];
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return [];
    return [{
      code: row.code.toUpperCase(),
      label: row.label,
      amount,
      notes: Array.isArray(row.notes) ? row.notes.filter((note): note is string => typeof note === "string") : [],
    }];
  });
}

function trace(entry: ExplainPayEntryInput) {
  const raw = (entry.trace ?? {}) as Record<string, unknown>;
  const inputs = Array.isArray(raw.inputs) ? raw.inputs.filter((line): line is string => typeof line === "string") : [];
  const values = new Map<string, string>();
  const narrative: string[] = [];
  for (const input of inputs) {
    const separator = input.indexOf("=");
    const key = separator > 0 ? input.slice(0, separator) : "";
    if (separator > 0 && /^[A-Za-z][A-Za-z0-9_]*$/.test(key)) values.set(key, input.slice(separator + 1));
    else narrative.push(input);
  }
  return { ruleVersion: typeof raw.ruleVersion === "string" ? raw.ruleVersion : null, values, narrative };
}

function numeric(values: Map<string, string>, key: string) {
  const raw = values.get(key);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function aggregate(entry: ExplainPayEntryInput) {
  const grouped = new Map<string, StoredLine>();
  for (const line of storedLines(entry)) {
    const key = `${line.code}|${line.label}`;
    const prior = grouped.get(key);
    if (!prior) grouped.set(key, { ...line });
    else {
      prior.amount = cents(prior.amount + line.amount);
      prior.notes = [...new Set([...prior.notes, ...line.notes])];
    }
  }
  return grouped;
}

function reasonFor(line: StoredLine, values: Map<string, string>, narrative: string[]) {
  const code = line.code;
  const note = line.notes.join(" · ");
  const hours = (minutes: number | null) => minutes == null ? null : Math.round((minutes / 60) * 100) / 100;
  const hourly = numeric(values, "hourlyRate");
  if (code === "BASIC") {
    const regular = hours(numeric(values, "regularMinutes"));
    const punches = numeric(values, "punches");
    const payBasis = values.get("payBasis");
    if (payBasis === "monthly") {
      return punches === 0
        ? "Monthly salaried basis keeps the configured cutoff salary even when no attendance punches are stored; attendance still needs review for exceptions."
        : "Monthly salaried basis keeps the configured cutoff salary. Attendance is used separately for overtime, night differential, tardiness, undertime and exceptions.";
    }
    if (payBasis === "daily") {
      return `Daily-paid basic is based on ${regular ?? 0} regular hour(s) converted through the employee's configured standard hours per day.`;
    }
    if (payBasis === "hourly") {
      return `Hourly-paid basic is based on ${regular ?? 0} regular hour(s)${hourly == null ? "" : ` at ${peso(hourly)} per hour`}.`;
    }
    return "Basic pay comes from the stored employee pay profile and attendance for this cutoff.";
  }
  if (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-")) {
    return note || "Approved leave was applied using the configured Paid, Unpaid, or Partially paid policy for this cutoff.";
  }
  if (code.startsWith("LEAVE_CONV-")) return note || "Approved leave conversion was included in this payroll.";
  if (code === "OT") return `Overtime is based on ${hours(numeric(values, "overtimeMinutes")) ?? 0} hour(s) at the configured overtime premium.`;
  if (code === "ND") return `Night differential is based on ${hours(numeric(values, "nightMinutes")) ?? 0} eligible hour(s).`;
  if (code === "LATE") return `Tardiness deduction reflects ${numeric(values, "tardinessMinutes") ?? 0} late minute(s).`;
  if (code === "UT") return `Undertime deduction reflects ${numeric(values, "undertimeMinutes") ?? 0} minute(s).`;
  if (code === "SSS") return `SSS employee share based on salary credit ${peso(numeric(values, "sssMonthlySalaryCredit") ?? 0)}.`;
  if (code === "PHIC" || code === "PHILHEALTH") return `PhilHealth employee share based on contribution base ${peso(numeric(values, "philHealthContributionBase") ?? 0)}.`;
  if (code === "HDMF" || code === "PAGIBIG" || code === "PAG-IBIG") return `Pag-IBIG employee share based on fund salary ${peso(numeric(values, "pagIbigFundSalary") ?? 0)}.`;
  if (code === "WHT" || code === "TAX") return `Withholding tax is based on taxable compensation of ${peso(numeric(values, "taxableCompensation") ?? 0)}.`;
  if (code.startsWith("LOAN-")) return note || "Scheduled employee-loan repayment for this cutoff.";
  if (code.startsWith("EWA-")) return note || "Earned-wage advance recovery for this cutoff.";
  if (code.startsWith("EXP-")) return note || "Approved expense reimbursement.";
  if (code === "HOLIDAY") return note || narrative.find((item) => /holiday/i.test(item)) || "Holiday or rest-day premium from attendance.";
  if (code === "CALAMITY") return note || narrative.find((item) => /calamity|hazard/i.test(item)) || "Configured calamity or hazard premium.";
  return note || (line.amount >= 0 ? "Stored earning included in gross pay." : "Stored deduction included in this payroll entry.");
}

export function buildPayExplanation(current: ExplainPayEntryInput, previous: ExplainPayEntryInput | null = null): ExplainPayModel {
  const currentTrace = trace(current);
  const now = aggregate(current);
  const before = previous ? aggregate(previous) : new Map<string, StoredLine>();
  const keys = new Set([...now.keys(), ...before.keys()]);

  const lines = [...keys].map((key): ExplainPayLine => {
    const currentLine = now.get(key);
    const previousLine = before.get(key);
    const basis = currentLine ?? previousLine!;
    const signedCurrent = currentLine?.amount ?? 0;
    const signedPrevious = previousLine?.amount ?? 0;
    const direction: "earning" | "deduction" = signedCurrent < 0 || (signedCurrent === 0 && signedPrevious < 0) ? "deduction" : "earning";
    const currentAmount = cents(Math.abs(signedCurrent));
    const previousAmount = previous ? cents(Math.abs(signedPrevious)) : null;
    const delta = previousAmount == null ? null : cents(currentAmount - previousAmount);
    return {
      code: basis.code,
      label: basis.label,
      direction,
      previous: previousAmount,
      current: currentAmount,
      delta,
      netEffectDelta: delta == null ? null : cents(direction === "earning" ? delta : -delta),
      reason: reasonFor(currentLine ?? { ...basis, amount: 0, notes: [] }, currentTrace.values, currentTrace.narrative),
      notes: currentLine?.notes ?? [],
    };
  }).sort((a,b) => Math.abs(b.netEffectDelta ?? b.current) - Math.abs(a.netEffectDelta ?? a.current));

  const currentNet = cents(numberOf(current.netPay));
  const previousNet = previous ? cents(numberOf(previous.netPay)) : null;
  const netDelta = previousNet == null ? null : cents(currentNet - previousNet);
  return {
    currentGross: cents(numberOf(current.grossPay)),
    currentDeductions: cents(numberOf(current.deductions)),
    currentNet,
    previousGross: previous ? cents(numberOf(previous.grossPay)) : null,
    previousDeductions: previous ? cents(numberOf(previous.deductions)) : null,
    previousNet,
    netDelta,
    netPercent: previousNet == null || previousNet === 0 ? null : cents((netDelta! / Math.abs(previousNet)) * 100),
    ruleVersion: currentTrace.ruleVersion,
    context: {
      payBasis: currentTrace.values.get("payBasis") ?? null,
      rateAmount: numeric(currentTrace.values, "rateAmount"),
      standardWorkDaysPerMonth: numeric(currentTrace.values, "standardWorkDaysPerMonth"),
      standardHoursPerDay: numeric(currentTrace.values, "standardHoursPerDay"),
      monthlyEquivalent: numeric(currentTrace.values, "monthlyEquivalent"),
      basicRate: numeric(currentTrace.values, "basicRate"),
      taxableCompensation: numeric(currentTrace.values, "taxableCompensation"),
      punches: numeric(currentTrace.values, "punches"),
      regularMinutes: numeric(currentTrace.values, "regularMinutes"),
      overtimeMinutes: numeric(currentTrace.values, "overtimeMinutes"),
      nightMinutes: numeric(currentTrace.values, "nightMinutes"),
      paidLeaveDays: numeric(currentTrace.values, "paidLeaveDays"),
      unpaidLeaveDays: numeric(currentTrace.values, "unpaidLeaveDays"),
      leavePayAdjustment: numeric(currentTrace.values, "leavePayAdjustment"),
      sssMonthlySalaryCredit: numeric(currentTrace.values, "sssMonthlySalaryCredit"),
      philHealthContributionBase: numeric(currentTrace.values, "philHealthContributionBase"),
      pagIbigFundSalary: numeric(currentTrace.values, "pagIbigFundSalary"),
      pagIbigEmployeeRate: numeric(currentTrace.values, "pagIbigEmployeeRate"),
      withholdingTable: currentTrace.values.get("withholdingTable") ?? null,
      region: currentTrace.values.get("region") ?? null,
      mwe: currentTrace.values.get("mwe") ?? null,
    },
    lines,
  };
}
