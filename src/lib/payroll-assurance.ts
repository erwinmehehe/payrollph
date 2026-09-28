export type AssuranceSeverity = "high" | "medium" | "info";

export type AssuranceLineItem = {
  code: string;
  label: string;
  amount: string | number;
};

export type AssuranceEntry = {
  id: number;
  employeeId: number;
  grossPay: string | number;
  deductions: string | number;
  netPay: string | number;
  status: string;
  lineItems?: unknown;
  trace?: unknown;
};

export type AssuranceFinding = {
  code: string;
  severity: AssuranceSeverity;
  title: string;
  detail: string;
  employeeId?: number;
  current?: number;
  previous?: number;
  delta?: number;
  percent?: number | null;
  blocking?: boolean;
};

export type LineVariance = {
  code: string;
  label: string;
  current: number;
  previous: number;
  delta: number;
};

export type PayrollComponentBreakdown = {
  gross: number;
  sss: number;
  philHealth: number;
  pagIbig: number;
  withholdingTax: number;
  otherDeductions: number;
  net: number;
};

export type EmployeeVariance = {
  employeeId: number;
  currentGross: number;
  previousGross: number | null;
  grossDelta: number | null;
  currentNet: number;
  previousNet: number | null;
  netDelta: number | null;
  netPercent: number | null;
  currentDeductions: number;
  previousDeductions: number | null;
  currentComponents: PayrollComponentBreakdown;
  previousComponents: PayrollComponentBreakdown | null;
  lineChanges: LineVariance[];
  hasMaterialChange: boolean;
};

export type PayrollAssurance = {
  findings: AssuranceFinding[];
  comparisons: EmployeeVariance[];
  summary: {
    high: number;
    medium: number;
    info: number;
    blocking: number;
    materialChanges: number;
    comparedEmployees: number;
  };
};

function numberOf(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function lineItemsOf(entry: AssuranceEntry): AssuranceLineItem[] {
  if (!Array.isArray(entry.lineItems)) return [];
  return entry.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    const amount = typeof row.amount === "string" || typeof row.amount === "number" ? row.amount : 0;
    return [{ code: row.code, label: row.label, amount }];
  });
}

function traceFlagsOf(entry: AssuranceEntry) {
  if (!entry.trace || typeof entry.trace !== "object") return [] as string[];
  const flags = (entry.trace as Record<string, unknown>).flags;
  return Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === "string") : [];
}


function lineAmountByCodes(entry: AssuranceEntry, codes: string[]) {
  const wanted = new Set(codes.map((code) => code.toUpperCase()));
  return cents(lineItemsOf(entry).reduce((sum, line) => {
    if (!wanted.has(line.code.toUpperCase())) return sum;
    return sum + Math.abs(numberOf(line.amount));
  }, 0));
}

export function payrollComponentsOf(entry: AssuranceEntry): PayrollComponentBreakdown {
  const deductions = Math.abs(numberOf(entry.deductions));
  const sss = lineAmountByCodes(entry, ["SSS"]);
  const philHealth = lineAmountByCodes(entry, ["PHIC", "PHILHEALTH"]);
  const pagIbig = lineAmountByCodes(entry, ["HDMF", "PAGIBIG", "PAG-IBIG"]);
  const withholdingTax = lineAmountByCodes(entry, ["WHT", "WITHHOLDING_TAX", "TAX"]);
  const knownDeductions = sss + philHealth + pagIbig + withholdingTax;

  return {
    gross: cents(numberOf(entry.grossPay)),
    sss,
    philHealth,
    pagIbig,
    withholdingTax,
    otherDeductions: cents(Math.max(0, deductions - knownDeductions)),
    net: cents(numberOf(entry.netPay)),
  };
}

function compareLines(current: AssuranceEntry, previous: AssuranceEntry | null): LineVariance[] {
  const currentLines = lineItemsOf(current);
  const previousLines = previous ? lineItemsOf(previous) : [];
  const previousMap = new Map(previousLines.map((line) => [line.code, line]));
  const currentMap = new Map(currentLines.map((line) => [line.code, line]));
  const codes = new Set([...currentMap.keys(), ...previousMap.keys()]);

  return [...codes]
    .map((code) => {
      const now = currentMap.get(code);
      const before = previousMap.get(code);
      const currentAmount = numberOf(now?.amount);
      const previousAmount = numberOf(before?.amount);
      return {
        code,
        label: now?.label ?? before?.label ?? code,
        current: cents(currentAmount),
        previous: cents(previousAmount),
        delta: cents(currentAmount - previousAmount),
      };
    })
    .filter((line) => Math.abs(line.delta) >= 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function evaluatePayrollAssurance(
  currentEntries: AssuranceEntry[],
  previousEntries: AssuranceEntry[] = [],
): PayrollAssurance {
  const previousByEmployee = new Map(previousEntries.map((entry) => [entry.employeeId, entry]));
  const findings: AssuranceFinding[] = [];
  const comparisons: EmployeeVariance[] = [];

  for (const entry of currentEntries) {
    const gross = numberOf(entry.grossPay);
    const deductions = numberOf(entry.deductions);
    const net = numberOf(entry.netPay);
    const previous = previousByEmployee.get(entry.employeeId) ?? null;
    const previousGross = previous ? numberOf(previous.grossPay) : null;
    const previousNet = previous ? numberOf(previous.netPay) : null;
    const previousDeductions = previous ? numberOf(previous.deductions) : null;
    const netDelta = previousNet == null ? null : cents(net - previousNet);
    const grossDelta = previousGross == null ? null : cents(gross - previousGross);
    const netPercent = previousNet == null ? null : percentChange(net, previousNet);
    const currentComponents = payrollComponentsOf(entry);
    const previousComponents = previous ? payrollComponentsOf(previous) : null;
    const lineChanges = compareLines(entry, previous);
    const materialChange =
      previousNet != null &&
      Math.abs(netDelta ?? 0) >= 2_000 &&
      (netPercent == null || Math.abs(netPercent) >= 20);

    comparisons.push({
      employeeId: entry.employeeId,
      currentGross: cents(gross),
      previousGross: previousGross == null ? null : cents(previousGross),
      grossDelta,
      currentNet: cents(net),
      previousNet: previousNet == null ? null : cents(previousNet),
      netDelta,
      netPercent: netPercent == null ? null : cents(netPercent),
      currentDeductions: cents(deductions),
      previousDeductions: previousDeductions == null ? null : cents(previousDeductions),
      currentComponents,
      previousComponents,
      lineChanges,
      hasMaterialChange: materialChange,
    });

    if (!previous) {
      findings.push({
        code: "NO_PRIOR_PAYROLL",
        severity: "info",
        title: "No prior payroll to compare",
        detail: "This employee has no entry in the previous payroll run, so variance review starts from this cutoff.",
        employeeId: entry.employeeId,
      });
    }

    const flags = traceFlagsOf(entry);
    if (entry.status === "Exception" || flags.length > 0) {
      findings.push({
        code: "ENGINE_EXCEPTION",
        severity: "medium",
        title: "Payroll engine exception",
        detail: flags[0] ?? "This employee was flagged by the payroll calculation and needs reviewer sign-off.",
        employeeId: entry.employeeId,
      });
    }

    if (gross > 0 && net <= 0) {
      findings.push({
        code: "NONPOSITIVE_NET",
        severity: "high",
        blocking: true,
        title: "Net pay is zero or negative",
        detail: "Gross compensation is positive but the calculated net pay is not. Resolve deductions before release.",
        employeeId: entry.employeeId,
        current: net,
      });
    }

    if (gross > 0 && deductions > gross + 0.01) {
      findings.push({
        code: "DEDUCTIONS_EXCEED_GROSS",
        severity: "high",
        blocking: true,
        title: "Deductions exceed gross pay",
        detail: "Employee deductions are greater than gross compensation. The run cannot be safely released.",
        employeeId: entry.employeeId,
        current: deductions,
      });
    }

    const codes = new Set(lineItemsOf(entry).map((line) => line.code));
    const missingStatutory = ["SSS", "PHIC", "HDMF"].filter((code) => !codes.has(code));
    if (gross > 0 && missingStatutory.length > 0) {
      findings.push({
        code: "MISSING_STATUTORY",
        severity: "high",
        blocking: true,
        title: "Statutory deduction is missing",
        detail: `Missing line item(s): ${missingStatutory.join(", ")}. Confirm the employee's statutory treatment before release.`,
        employeeId: entry.employeeId,
      });
    }

    if (gross > 0 && deductions / gross >= 0.6) {
      findings.push({
        code: "HIGH_DEDUCTION_RATIO",
        severity: "medium",
        title: "High deduction ratio",
        detail: `Deductions consume ${Math.round((deductions / gross) * 100)}% of gross pay. Review loans, advances, benefits and tax before release.`,
        employeeId: entry.employeeId,
        current: deductions,
      });
    }

    if (materialChange && previousNet != null && netDelta != null) {
      findings.push({
        code: "MATERIAL_NET_VARIANCE",
        severity: "medium",
        title: "Material net-pay change",
        detail: `Net pay changed by ${netPercent == null ? "a material amount" : `${Math.abs(netPercent).toFixed(1)}%`} from the previous payroll.`,
        employeeId: entry.employeeId,
        current: net,
        previous: previousNet,
        delta: netDelta,
        percent: netPercent == null ? null : cents(netPercent),
      });
    }
  }

  const summary = {
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    blocking: findings.filter((finding) => finding.blocking).length,
    materialChanges: comparisons.filter((comparison) => comparison.hasMaterialChange).length,
    comparedEmployees: comparisons.filter((comparison) => comparison.previousNet != null).length,
  };

  return { findings, comparisons, summary };
}

export function explainEmployeeVariance(comparison: EmployeeVariance) {
  if (comparison.previousNet == null || comparison.netDelta == null) {
    return {
      headline: "No previous payroll comparison",
      lines: comparison.lineChanges.slice(0, 8),
    };
  }

  const direction = comparison.netDelta >= 0 ? "higher" : "lower";
  return {
    headline: `Net pay is ₱${Math.abs(comparison.netDelta).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${direction} than the previous payroll.`,
    lines: comparison.lineChanges.slice(0, 8),
  };
}
