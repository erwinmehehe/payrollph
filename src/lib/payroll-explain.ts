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

export type ExplainPayContext = {
  monthlyBasicRate: number | null;
  hourlyRate: number | null;
  taxableCompensation: number | null;
  punches: number | null;
  regularMinutes: number | null;
  overtimeMinutes: number | null;
  nightMinutes: number | null;
  tardinessMinutes: number | null;
  undertimeMinutes: number | null;
  sssMonthlySalaryCredit: number | null;
  philHealthContributionBase: number | null;
  pagIbigFundSalary: number | null;
  pagIbigEmployeeRate: number | null;
  region: string | null;
  mwe: string | null;
  withholdingTable: string | null;
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
  context: ExplainPayContext;
  lines: ExplainPayLine[];
};

type StoredLine = {
  code: string;
  label: string;
  amount: number;
  notes: string[];
};

function numberOf(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number) {
  return `₱${cents(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function hours(minutes: number | null) {
  if (minutes == null) return null;
  const value = Math.round((minutes / 60) * 100) / 100;
  return `${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })} hour${value === 1 ? "" : "s"}`;
}

function readStoredLines(entry: ExplainPayEntryInput): StoredLine[] {
  if (!Array.isArray(entry.lineItems)) return [];
  return entry.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    if (typeof row.amount !== "string" && typeof row.amount !== "number") return [];
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) return [];
    return [{
      code: row.code,
      label: row.label,
      amount,
      notes: Array.isArray(row.notes)
        ? row.notes.filter((note): note is string => typeof note === "string")
        : [],
    }];
  });
}

function readTrace(entry: ExplainPayEntryInput) {
  const raw = (entry.trace ?? {}) as Record<string, unknown>;
  const inputs = Array.isArray(raw.inputs)
    ? raw.inputs.filter((line): line is string => typeof line === "string")
    : [];
  const values = new Map<string, string>();
  const narrative: string[] = [];

  for (const input of inputs) {
    const separator = input.indexOf("=");
    if (separator <= 0) {
      narrative.push(input);
      continue;
    }
    const key = input.slice(0, separator);
    const value = input.slice(separator + 1);
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) values.set(key, value);
    else narrative.push(input);
  }

  return {
    ruleVersion: typeof raw.ruleVersion === "string" ? raw.ruleVersion : null,
    values,
    narrative,
  };
}

function numericTrace(values: Map<string, string>, key: string) {
  const raw = values.get(key);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function textTrace(values: Map<string, string>, key: string) {
  const raw = values.get(key);
  return raw == null || raw === "" ? null : raw;
}

function aggregateLines(entry: ExplainPayEntryInput) {
  const grouped = new Map<string, StoredLine>();
  for (const line of readStoredLines(entry)) {
    const key = `${line.code.toUpperCase()}|${line.label}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...line, code: line.code.toUpperCase() });
      continue;
    }
    existing.amount = cents(existing.amount + line.amount);
    existing.notes = [...new Set([...existing.notes, ...line.notes])];
  }
  return grouped;
}

function rankLine(code: string, direction: "earning" | "deduction") {
  if (code === "BASIC") return 10;
  if (code === "OT") return 20;
  if (code === "HOLIDAY") return 30;
  if (code === "ND") return 40;
  if (code === "CALAMITY") return 50;
  if (code.startsWith("LEAVE_CONV-")) return 60;
  if (code.startsWith("EXP-")) return 70;
  if (code.startsWith("DM-")) return 80;
  if (direction === "earning") return 90;
  if (code === "LATE") return 100;
  if (code === "UT") return 110;
  if (code === "SSS") return 120;
  if (code === "PHIC" || code === "PHILHEALTH") return 130;
  if (code === "HDMF" || code === "PAGIBIG" || code === "PAG-IBIG") return 140;
  if (code === "WHT" || code === "WITHHOLDING_TAX" || code === "TAX") return 150;
  if (code.startsWith("EWA-")) return 160;
  if (code.startsWith("LOAN-")) return 170;
  return 180;
}

function reasonFor(
  line: StoredLine,
  context: ExplainPayContext,
  traceNarrative: string[],
) {
  const code = line.code.toUpperCase();
  const note = line.notes.filter(Boolean).join(" · ");

  if (code === "BASIC") {
    if (context.punches === 0) {
      return "No attendance records were stored for this cutoff, so the engine used the configured semi-monthly basic-pay fallback.";
    }
    const regular = hours(context.regularMinutes);
    if (regular && context.punches != null) {
      return `Based on ${regular} from ${context.punches} attendance record${context.punches === 1 ? "" : "s"}${context.hourlyRate != null ? ` at a stored hourly rate of ${money(context.hourlyRate)}` : ""}.`;
    }
    return "Basic/worked pay comes from the attendance-derived regular minutes stored by the payroll engine.";
  }

  if (code === "OT") {
    const overtime = hours(context.overtimeMinutes);
    return overtime
      ? `${overtime} of overtime at the configured 25% regular overtime premium${context.hourlyRate != null ? ` on a ${money(context.hourlyRate)} hourly rate` : ""}.`
      : "Overtime pay comes from the overtime minutes captured in this cutoff.";
  }

  if (code === "HOLIDAY") {
    return note || traceNarrative.find((item) => /holiday|regular|special/i.test(item)) || "Holiday or rest-day premium recorded by the payroll engine for this cutoff.";
  }

  if (code === "ND") {
    const night = hours(context.nightMinutes);
    return night
      ? `${night} inside the 10 PM to 6 AM night-differential window at the configured 10% premium.`
      : "Night differential comes from eligible minutes inside the configured night window.";
  }

  if (code === "LATE") {
    return context.tardinessMinutes != null
      ? `${context.tardinessMinutes} late minute${context.tardinessMinutes === 1 ? "" : "s"} beyond the configured grace period, valued using the stored hourly rate.`
      : "Late deduction recorded from attendance for this cutoff.";
  }

  if (code === "UT") {
    return context.undertimeMinutes != null
      ? `${context.undertimeMinutes} undertime minute${context.undertimeMinutes === 1 ? "" : "s"} before the scheduled shift end, valued using the stored hourly rate.`
      : "Undertime deduction recorded from attendance for this cutoff.";
  }

  if (code === "SSS") {
    return context.sssMonthlySalaryCredit != null
      ? `SSS employee share using a monthly salary credit of ${money(context.sssMonthlySalaryCredit)}, then split across two semi-monthly cutoffs.`
      : "SSS employee contribution from the payroll ruleset stored with this run.";
  }

  if (code === "PHIC" || code === "PHILHEALTH") {
    return context.philHealthContributionBase != null
      ? `PhilHealth employee share using a contribution base of ${money(context.philHealthContributionBase)}, with the monthly employee share split across two cutoffs.`
      : "PhilHealth employee contribution from the payroll ruleset stored with this run.";
  }

  if (code === "HDMF" || code === "PAGIBIG" || code === "PAG-IBIG") {
    const rate = context.pagIbigEmployeeRate == null ? null : `${(context.pagIbigEmployeeRate * 100).toFixed(0)}%`;
    return context.pagIbigFundSalary != null
      ? `Pag-IBIG employee share using fund salary ${money(context.pagIbigFundSalary)}${rate ? ` at a ${rate} monthly employee rate` : ""}, then split across two cutoffs.`
      : "Pag-IBIG employee contribution from the payroll ruleset stored with this run.";
  }

  if (code === "WHT" || code === "WITHHOLDING_TAX" || code === "TAX") {
    return context.taxableCompensation != null
      ? `BIR semi-monthly withholding on taxable compensation of ${money(context.taxableCompensation)} using ${context.withholdingTable ?? "the revised withholding table"}.`
      : "BIR withholding tax from the payroll ruleset stored with this run.";
  }

  if (code.startsWith("EXP-")) {
    return note || "Approved expense reimbursement included as a non-taxable addition to pay.";
  }

  if (code.startsWith("DM-")) {
    return note || "De minimis benefit included using the stored tax-exempt ceiling and taxable-excess treatment.";
  }

  if (code.startsWith("LEAVE_CONV-")) {
    return note || "Approved leave conversion included in this payroll cutoff.";
  }

  if (code.startsWith("EWA-")) {
    return note || "Approved earned-wage advance recovered in this cutoff.";
  }

  if (code.startsWith("LOAN-")) {
    return note || "Scheduled employee-loan repayment deducted in this cutoff.";
  }

  if (line.label.toLowerCase().startsWith("benefit")) {
    return note || "Employee share of an active benefit enrollment for this cutoff.";
  }

  if (code === "CALAMITY") {
    return note || traceNarrative.find((item) => /calamity|hazard/i.test(item)) || "Configured calamity or hazard premium applied in this cutoff.";
  }

  return note || (line.amount >= 0
    ? "Stored earning included in gross compensation for this cutoff."
    : "Stored deduction included in this payroll entry.");
}

export function buildPayExplanation(
  current: ExplainPayEntryInput,
  previous: ExplainPayEntryInput | null = null,
): ExplainPayModel {
  const currentTrace = readTrace(current);
  const values = currentTrace.values;
  const context: ExplainPayContext = {
    monthlyBasicRate: numericTrace(values, "basicRate"),
    hourlyRate: numericTrace(values, "hourlyRate"),
    taxableCompensation: numericTrace(values, "taxableCompensation"),
    punches: numericTrace(values, "punches"),
    regularMinutes: numericTrace(values, "regularMinutes"),
    overtimeMinutes: numericTrace(values, "overtimeMinutes"),
    nightMinutes: numericTrace(values, "nightMinutes"),
    tardinessMinutes: numericTrace(values, "tardinessMinutes"),
    undertimeMinutes: numericTrace(values, "undertimeMinutes"),
    sssMonthlySalaryCredit: numericTrace(values, "sssMonthlySalaryCredit"),
    philHealthContributionBase: numericTrace(values, "philHealthContributionBase"),
    pagIbigFundSalary: numericTrace(values, "pagIbigFundSalary"),
    pagIbigEmployeeRate: numericTrace(values, "pagIbigEmployeeRate"),
    region: textTrace(values, "region"),
    mwe: textTrace(values, "mwe"),
    withholdingTable: textTrace(values, "withholdingTable"),
  };

  const currentLines = aggregateLines(current);
  const previousLines = previous ? aggregateLines(previous) : new Map<string, StoredLine>();
  const keys = new Set([...currentLines.keys(), ...previousLines.keys()]);

  const lines = [...keys].map((key): ExplainPayLine => {
    const currentLine = currentLines.get(key);
    const previousLine = previousLines.get(key);
    const basis = currentLine ?? previousLine!;
    const signedCurrent = currentLine?.amount ?? 0;
    const signedPrevious = previousLine?.amount ?? 0;
    const direction: "earning" | "deduction" =
      signedCurrent < 0 || (signedCurrent === 0 && signedPrevious < 0) ? "deduction" : "earning";
    const currentAmount = cents(Math.abs(signedCurrent));
    const previousAmount = previous ? cents(Math.abs(signedPrevious)) : null;
    const delta = previousAmount == null ? null : cents(currentAmount - previousAmount);
    const netEffectDelta = delta == null ? null : cents(direction === "earning" ? delta : -delta);

    return {
      code: basis.code.toUpperCase(),
      label: basis.label,
      direction,
      previous: previousAmount,
      current: currentAmount,
      delta,
      netEffectDelta,
      reason: reasonFor(currentLine ?? { ...basis, amount: 0, notes: [] }, context, currentTrace.narrative),
      notes: currentLine?.notes ?? [],
    };
  }).sort((a, b) => {
    const rank = rankLine(a.code, a.direction) - rankLine(b.code, b.direction);
    return rank || a.label.localeCompare(b.label);
  });

  const currentNet = cents(numberOf(current.netPay));
  const previousNet = previous ? cents(numberOf(previous.netPay)) : null;
  const netDelta = previousNet == null ? null : cents(currentNet - previousNet);
  const netPercent = previousNet == null || previousNet === 0
    ? null
    : cents((netDelta! / Math.abs(previousNet)) * 100);

  return {
    currentGross: cents(numberOf(current.grossPay)),
    currentDeductions: cents(numberOf(current.deductions)),
    currentNet,
    previousGross: previous ? cents(numberOf(previous.grossPay)) : null,
    previousDeductions: previous ? cents(numberOf(previous.deductions)) : null,
    previousNet,
    netDelta,
    netPercent,
    ruleVersion: currentTrace.ruleVersion,
    context,
    lines,
  };
}
