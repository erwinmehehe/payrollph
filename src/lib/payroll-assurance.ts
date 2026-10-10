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

export type AssuranceEmployeeContext = {
  id: number;
  employeeNo?: string | null;
  status?: string | null;
  startDate?: string | null;
  basicRate?: string | number | null;
  region?: string | null;
  bankAccount?: string | null;
  bankCode?: string | null;
  minimumWageIssue?: boolean;
};

export type AssuranceContext = {
  periodStart?: string | null;
  periodEnd?: string | null;
  payDate?: string | null;
  employees?: AssuranceEmployeeContext[];
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

function traceInputsOf(entry: AssuranceEntry) {
  if (!entry.trace || typeof entry.trace !== "object") return [] as string[];
  const inputs = (entry.trace as Record<string, unknown>).inputs;
  return Array.isArray(inputs) ? inputs.filter((line): line is string => typeof line === "string") : [];
}

function traceNumber(entry: AssuranceEntry, key: string) {
  const prefix = `${key}=`;
  const raw = traceInputsOf(entry).find((line) => line.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function positiveLineAmount(entry: AssuranceEntry, code: string) {
  return cents(lineItemsOf(entry).reduce((sum, line) => {
    if (line.code.toUpperCase() !== code.toUpperCase()) return sum;
    return sum + Math.max(0, numberOf(line.amount));
  }, 0));
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
  const pagIbig = lineAmountByCodes(entry, ["HDMF", "HDMF_VOL", "PAGIBIG", "PAG-IBIG"]);
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
  context: AssuranceContext = {},
): PayrollAssurance {
  const previousByEmployee = new Map(previousEntries.map((entry) => [entry.employeeId, entry]));
  const employeeById = new Map((context.employees ?? []).map((employee) => [employee.id, employee]));
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

    // Unlike a routine reviewable engine warning, an invalid loan schedule
    // must not be waived with acknowledgeExceptions: gross-to-net excluded a
    // required deduction and the employer must repair source data, then recalculate.
    const invalidLoanSchedule = flags.find((flag) => flag.startsWith("PAYROLL_LOAN_SCHEDULE_INVALID:"));
    if (invalidLoanSchedule) {
      findings.push({
        code: "INVALID_PAYROLL_LOAN_SCHEDULE",
        severity: "high",
        blocking: true,
        title: "Employee loan deduction schedule is invalid",
        detail: `Correct the source loan amounts and recalculate payroll before checker approval or release. ${invalidLoanSchedule}`,
        employeeId: entry.employeeId,
      });
    }

    // An unlocated break or ambiguous split-shift boundary can change the
    // legally payable night, holiday, rest-day or overtime premium bucket.
    // Do not allow a checker to approve guessed premium allocation.
    const ambiguousPremium = flags.find((flag) =>
      /premium allocation requires review|premium allocation was not inferred|calendar-boundary pricing was not applied|verify split\/shift attendance before release/i.test(flag)
    );
    if (ambiguousPremium) {
      findings.push({
        code: "WFM_PREMIUM_ALLOCATION_UNVERIFIED",
        severity: "high",
        blocking: true,
        title: "Workforce premium allocation needs verified attendance",
        detail: `Correct the actual punch, break or shift evidence and recalculate payroll before checker approval. ${ambiguousPremium}`,
        employeeId: entry.employeeId,
      });
    }

    const employee = employeeById.get(entry.employeeId);
    const punches = traceNumber(entry, "punches");
    const payBasis = traceInputsOf(entry)
      .find((line) => line.startsWith("payBasis="))
      ?.slice("payBasis=".length);
    if (punches === 0 && gross > 0) {
      findings.push({
        code: "MISSING_ATTENDANCE",
        severity: "medium",
        title: "No attendance recorded for this cutoff",
        detail: payBasis === "monthly"
          ? "This employee is explicitly monthly salaried, so basic pay remains fixed. Confirm the missing attendance before approval because overtime, undertime and attendance exceptions cannot be validated."
          : "This daily/hourly employee has positive gross pay without punches, likely from paid leave or another earning. Confirm the attendance and earning source before approval.",
        employeeId: entry.employeeId,
      });
    }

    const basic = positiveLineAmount(entry, "BASIC");
    const overtime = positiveLineAmount(entry, "OT");
    if (basic > 0 && overtime >= 5_000 && overtime / basic >= 0.25) {
      findings.push({
        code: "UNUSUAL_OVERTIME",
        severity: "medium",
        title: "Unusually high overtime",
        detail: `Overtime is ₱${overtime.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, or ${Math.round((overtime / basic) * 100)}% of basic/worked pay for this cutoff.`,
        employeeId: entry.employeeId,
        current: overtime,
      });
    }

    if (previous) {
      const previousBasic = positiveLineAmount(previous, "BASIC");
      if (previousBasic > 0) {
        const basicDelta = cents(basic - previousBasic);
        const basicPercent = percentChange(basic, previousBasic);
        if (Math.abs(basicDelta) >= 1_000 && basicPercent != null && Math.abs(basicPercent) >= 15) {
          findings.push({
            code: "SALARY_CHANGE",
            severity: "medium",
            title: "Material basic-pay change",
            detail: `Basic/worked pay changed by ${Math.abs(basicPercent).toFixed(1)}% from the previous released payroll.`,
            employeeId: entry.employeeId,
            current: basic,
            previous: previousBasic,
            delta: basicDelta,
            percent: cents(basicPercent),
          });
        }
      }

      const currentStatutory = currentComponents.sss + currentComponents.philHealth + currentComponents.pagIbig;
      const previousStatutory = previousComponents
        ? previousComponents.sss + previousComponents.philHealth + previousComponents.pagIbig
        : 0;
      const statutoryDelta = cents(currentStatutory - previousStatutory);
      const statutoryPercent = previousStatutory > 0 ? percentChange(currentStatutory, previousStatutory) : null;
      if (
        previousStatutory > 0 &&
        Math.abs(statutoryDelta) >= 500 &&
        statutoryPercent != null &&
        Math.abs(statutoryPercent) >= 15
      ) {
        findings.push({
          code: "STATUTORY_CHANGE",
          severity: "medium",
          title: "Material statutory contribution change",
          detail: `SSS, PhilHealth and Pag-IBIG employee deductions changed by ${Math.abs(statutoryPercent).toFixed(1)}% from the previous released payroll.`,
          employeeId: entry.employeeId,
          current: currentStatutory,
          previous: previousStatutory,
          delta: statutoryDelta,
          percent: cents(statutoryPercent),
        });
      }
    }

    const positiveCodes = lineItemsOf(entry)
      .filter((line) => numberOf(line.amount) > 0)
      .map((line) => line.code.toUpperCase());
    const duplicateCodes = [...new Set(positiveCodes.filter((code, index) => positiveCodes.indexOf(code) !== index))];
    if (duplicateCodes.length > 0) {
      findings.push({
        code: "DUPLICATE_EARNING",
        severity: "medium",
        title: "Possible duplicate earning",
        detail: `The payroll entry contains repeated positive line-item code(s): ${duplicateCodes.join(", ")}. Confirm the allowance or earning was not added twice.`,
        employeeId: entry.employeeId,
      });
    }

    if (employee && net > 0 && (!employee.bankAccount?.trim() || !employee.bankCode?.trim())) {
      findings.push({
        code: "MISSING_BANK_DETAILS",
        severity: "high",
        blocking: true,
        title: "Bank details are incomplete",
        detail: "This employee has positive net pay but no complete bank account and bank code. Complete payout details before release.",
        employeeId: entry.employeeId,
      });
    }

    if (
      employee?.startDate &&
      context.periodStart &&
      context.periodEnd &&
      employee.startDate >= context.periodStart &&
      employee.startDate <= context.periodEnd
    ) {
      findings.push({
        code: "NEW_EMPLOYEE",
        severity: "info",
        title: "New employee in this cutoff",
        detail: `Employment start date ${employee.startDate} falls inside this payroll period. Confirm proration and onboarding details.`,
        employeeId: entry.employeeId,
      });
    }

    const employmentStatus = employee?.status?.toLowerCase() ?? "";
    if (employmentStatus.includes("separat") || employmentStatus.includes("resign") || employmentStatus.includes("terminat")) {
      findings.push({
        code: "SEPARATING_EMPLOYEE",
        severity: "medium",
        title: "Separating employee included",
        detail: `Employee status is "${employee?.status}". Confirm final-pay treatment and cut-off before approval.`,
        employeeId: entry.employeeId,
      });
    }

    if (employee?.minimumWageIssue) {
      findings.push({
        code: "WAGE_FLOOR",
        severity: "medium",
        title: "Basic rate is below the mapped wage floor",
        detail: "The employee's monthly basic maps below the configured regional minimum-wage equivalent. Review the wage-order mapping and employee classification.",
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

    const payrollLines = lineItemsOf(entry);
    const codes = new Set(payrollLines.map((line) => line.code.toUpperCase()));
    const statutoryCompensation = payrollLines.reduce((sum, line) => {
      const code = line.code.toUpperCase();
      const isCompensation =
        code === "BASIC" ||
        code === "OT" ||
        code === "ND" ||
        code === "HOLIDAY" ||
        code === "CALAMITY" ||
        code.startsWith("LEAVE_CONV-") ||
        (code.startsWith("LEAVE-") && numberOf(line.amount) > 0);
      return isCompensation ? sum + Math.max(0, numberOf(line.amount)) : sum;
    }, 0);
    const missingStatutory = ["SSS", "PHIC", "HDMF"].filter((code) => !codes.has(code));
    if (statutoryCompensation > 0.01 && missingStatutory.length > 0) {
      findings.push({
        code: "MISSING_STATUTORY",
        severity: "medium",
        title: "Statutory treatment needs review",
        detail: `The stored payroll breakdown has no ${missingStatutory.join(", ")} line item(s). This can be valid when the contribution is zero or excluded, so confirm the employee's statutory treatment before approval.`,
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
