export type PayrollControlSeverity = "high" | "medium" | "info";

export type PayrollControlEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

export type PayrollControlEntry = {
  id: number;
  employeeId: number;
  grossPay: string | number;
  deductions: string | number;
  netPay: string | number;
  status: string;
  trace?: unknown;
  lineItems?: unknown;
};

export type PayrollControlTask = {
  id: number;
  status: string;
  title: string;
  detail: string;
  approver: string;
};

export type ParallelPayrollRow = {
  employeeNo: string;
  name?: string;
  netPay: number;
  withholdingTax?: number | null;
};

export type PayrollControlIssue = {
  id: string;
  severity: PayrollControlSeverity;
  code:
    | "ENGINE_EXCEPTION"
    | "NEGATIVE_NET"
    | "HIGH_DEDUCTIONS"
    | "NET_VARIANCE"
    | "PARALLEL_VARIANCE"
    | "MISSING_EMPLOYEE"
    | "DUPLICATE_EMPLOYEE"
    | "UNRECONCILED_LINES"
    | "REFERENCE_UNMATCHED";
  employeeId?: number;
  employeeName?: string;
  title: string;
  detail: string;
  delta?: number;
};

export type PayrollVarianceRow = {
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  currentNet: number;
  previousNet: number | null;
  previousDelta: number | null;
  previousDeltaPercent: number | null;
  referenceNet: number | null;
  referenceDelta: number | null;
};

export type PayrollReadiness = {
  verdict: "ready" | "review" | "blocked";
  label: "Ready for release" | "Review required" | "Blocked";
  highCount: number;
  mediumCount: number;
  checks: Array<{
    key: "calculated" | "exceptions" | "audit" | "approval" | "parallel";
    label: string;
    state: "pass" | "review" | "blocked" | "optional";
    detail: string;
  }>;
};

type AuditInput = {
  entries: PayrollControlEntry[];
  employees: PayrollControlEmployee[];
  previousEntries?: PayrollControlEntry[];
  parallelRows?: ParallelPayrollRow[];
  approvalTask?: PayrollControlTask;
};

const numberOf = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeHeader = (value: string) =>
  normalize(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

function csvCells(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseMoney(value: string) {
  const cleaned = value.replace(/[₱,$\s]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function parseParallelPayrollCsv(text: string): {
  rows: ParallelPayrollRow[];
  errors: string[];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: ["The CSV needs a header row and at least one payroll row."] };
  }

  const headers = csvCells(lines[0]).map(normalizeHeader);
  const employeeIndex = headers.findIndex((header) =>
    ["employee_no", "employee_number", "employee_id", "employee_code", "id"].includes(header),
  );
  const nameIndex = headers.findIndex((header) =>
    ["name", "employee_name", "full_name"].includes(header),
  );
  const netIndex = headers.findIndex((header) =>
    ["net_pay", "net", "existing_net_pay", "take_home_pay", "take_home"].includes(header),
  );
  const withholdingIndex = headers.findIndex((header) =>
    ["withholding_tax", "tax", "existing_withholding_tax"].includes(header),
  );

  if (employeeIndex < 0 && nameIndex < 0) {
    return {
      rows: [],
      errors: ["Add an employee_no (preferred) or name column so Linaw can match each row."],
    };
  }
  if (netIndex < 0) {
    return {
      rows: [],
      errors: ["Add a net_pay column. Parallel Payroll compares the imported net pay with Linaw's independent result."],
    };
  }

  const rows: ParallelPayrollRow[] = [];
  const errors: string[] = [];

  lines.slice(1).forEach((line, rowIndex) => {
    const cells = csvCells(line);
    const employeeNo = employeeIndex >= 0 ? String(cells[employeeIndex] ?? "").trim() : "";
    const name = nameIndex >= 0 ? String(cells[nameIndex] ?? "").trim() : "";
    const netPay = parseMoney(String(cells[netIndex] ?? ""));
    const withholding =
      withholdingIndex >= 0 && String(cells[withholdingIndex] ?? "").trim()
        ? parseMoney(String(cells[withholdingIndex] ?? ""))
        : null;

    if (!employeeNo && !name) {
      errors.push(`Row ${rowIndex + 2}: missing employee identifier.`);
      return;
    }
    if (!Number.isFinite(netPay)) {
      errors.push(`Row ${rowIndex + 2}: net_pay is not a valid amount.`);
      return;
    }

    rows.push({
      employeeNo,
      name: name || undefined,
      netPay: round2(netPay),
      withholdingTax: withholding !== null && Number.isFinite(withholding) ? round2(withholding) : null,
    });
  });

  return { rows, errors };
}

function lineItems(entry: PayrollControlEntry) {
  if (!Array.isArray(entry.lineItems)) return [] as Array<{ code: string; label: string; amount: number }>;

  return entry.lineItems.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const amount = numberOf(row.amount);
    if (typeof row.code !== "string" || typeof row.label !== "string") return [];
    return [{ code: row.code, label: row.label, amount }];
  });
}

function traceFlags(entry: PayrollControlEntry) {
  if (!entry.trace || typeof entry.trace !== "object") return [] as string[];
  const flags = (entry.trace as Record<string, unknown>).flags;
  return Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === "string") : [];
}

function employeeName(employee?: PayrollControlEmployee) {
  return employee ? `${employee.firstName} ${employee.lastName}` : undefined;
}

function matchParallel(
  employee: PayrollControlEmployee | undefined,
  rows: ParallelPayrollRow[],
) {
  if (!employee) return undefined;
  const byNo = rows.find((row) => row.employeeNo && normalize(row.employeeNo) === normalize(employee.employeeNo));
  if (byNo) return byNo;

  const targetName = normalize(`${employee.firstName} ${employee.lastName}`);
  return rows.find((row) => row.name && normalize(row.name) === targetName);
}

export function payrollVarianceRows(input: AuditInput): PayrollVarianceRow[] {
  const previousByEmployee = new Map((input.previousEntries ?? []).map((entry) => [entry.employeeId, entry]));
  const rows = input.parallelRows ?? [];

  return input.entries.map((entry) => {
    const employee = input.employees.find((person) => person.id === entry.employeeId);
    const previous = previousByEmployee.get(entry.employeeId);
    const parallel = matchParallel(employee, rows);
    const currentNet = numberOf(entry.netPay);
    const previousNet = previous ? numberOf(previous.netPay) : null;
    const previousDelta = previousNet === null ? null : round2(currentNet - previousNet);
    const previousDeltaPercent =
      previousNet === null || previousNet === 0 ? null : round2((previousDelta! / Math.abs(previousNet)) * 100);
    const referenceNet = parallel ? parallel.netPay : null;

    return {
      employeeId: entry.employeeId,
      employeeNo: employee?.employeeNo ?? String(entry.employeeId),
      employeeName: employeeName(employee) ?? `Employee #${entry.employeeId}`,
      currentNet,
      previousNet,
      previousDelta,
      previousDeltaPercent,
      referenceNet,
      referenceDelta: referenceNet === null ? null : round2(currentNet - referenceNet),
    };
  });
}

export function auditPayrollControl(input: AuditInput): {
  issues: PayrollControlIssue[];
  variances: PayrollVarianceRow[];
  readiness: PayrollReadiness;
} {
  const issues: PayrollControlIssue[] = [];
  const seen = new Set<number>();
  const variances = payrollVarianceRows(input);

  for (const entry of input.entries) {
    const employee = input.employees.find((person) => person.id === entry.employeeId);
    const name = employeeName(employee);
    const gross = numberOf(entry.grossPay);
    const deductions = numberOf(entry.deductions);
    const net = numberOf(entry.netPay);

    if (!employee) {
      issues.push({
        id: `missing-employee-${entry.id}`,
        severity: "high",
        code: "MISSING_EMPLOYEE",
        employeeId: entry.employeeId,
        title: "Payroll entry has no matching employee",
        detail: `Entry #${entry.id} points to employee #${entry.employeeId}, but that employee is not in the current payroll scope.`,
      });
    }

    if (seen.has(entry.employeeId)) {
      issues.push({
        id: `duplicate-employee-${entry.id}`,
        severity: "high",
        code: "DUPLICATE_EMPLOYEE",
        employeeId: entry.employeeId,
        employeeName: name,
        title: "Duplicate employee in payroll",
        detail: "The same employee appears more than once in this payroll register.",
      });
    }
    seen.add(entry.employeeId);

    if (net < 0) {
      issues.push({
        id: `negative-net-${entry.id}`,
        severity: "high",
        code: "NEGATIVE_NET",
        employeeId: entry.employeeId,
        employeeName: name,
        title: "Negative net pay",
        detail: "Net pay is below zero and must be resolved before release.",
        delta: net,
      });
    }

    if (gross > 0 && deductions > gross * 0.35) {
      issues.push({
        id: `high-deductions-${entry.id}`,
        severity: "medium",
        code: "HIGH_DEDUCTIONS",
        employeeId: entry.employeeId,
        employeeName: name,
        title: "Unusually high deductions",
        detail: `Deductions are ${Math.round((deductions / gross) * 100)}% of gross pay.`,
        delta: deductions,
      });
    }

    if (entry.status.toLowerCase() === "exception") {
      const flags = traceFlags(entry);
      issues.push({
        id: `engine-exception-${entry.id}`,
        severity: "medium",
        code: "ENGINE_EXCEPTION",
        employeeId: entry.employeeId,
        employeeName: name,
        title: "Payroll engine exception",
        detail: flags.length ? flags.join(" · ") : "The payroll engine marked this entry for review.",
      });
    }

    const lines = lineItems(entry);
    if (lines.length) {
      const positive = lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0);
      const negative = lines.filter((line) => line.amount < 0).reduce((sum, line) => sum + Math.abs(line.amount), 0);
      const grossGap = round2(gross - positive);
      const deductionGap = round2(deductions - negative);
      if (Math.abs(grossGap) >= 0.01 || Math.abs(deductionGap) >= 0.01) {
        issues.push({
          id: `line-reconcile-${entry.id}`,
          severity: "high",
          code: "UNRECONCILED_LINES",
          employeeId: entry.employeeId,
          employeeName: name,
          title: "Stored line items do not reconcile",
          detail: [
            Math.abs(grossGap) >= 0.01 ? `Gross differs by ₱${Math.abs(grossGap).toFixed(2)}` : null,
            Math.abs(deductionGap) >= 0.01 ? `Deductions differ by ₱${Math.abs(deductionGap).toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    }
  }

  for (const variance of variances) {
    if (
      variance.previousNet !== null &&
      variance.previousDelta !== null &&
      Math.abs(variance.previousDelta) > Math.max(2_500, Math.abs(variance.previousNet) * 0.2)
    ) {
      issues.push({
        id: `prior-variance-${variance.employeeId}`,
        severity: "medium",
        code: "NET_VARIANCE",
        employeeId: variance.employeeId,
        employeeName: variance.employeeName,
        title: "Net pay changed materially",
        detail: `Net pay changed by ₱${Math.abs(variance.previousDelta).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} (${Math.abs(variance.previousDeltaPercent ?? 0).toFixed(1)}%) from the previous payroll.`,
        delta: variance.previousDelta,
      });
    }

    if (variance.referenceNet !== null && variance.referenceDelta !== null && Math.abs(variance.referenceDelta) >= 1) {
      issues.push({
        id: `parallel-variance-${variance.employeeId}`,
        severity: Math.abs(variance.referenceDelta) >= 500 ? "high" : "medium",
        code: "PARALLEL_VARIANCE",
        employeeId: variance.employeeId,
        employeeName: variance.employeeName,
        title: "Parallel Payroll mismatch",
        detail: `Linaw differs from the imported payroll by ₱${Math.abs(variance.referenceDelta).toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}.`,
        delta: variance.referenceDelta,
      });
    }
  }

  if (input.parallelRows?.length) {
    for (const reference of input.parallelRows) {
      const matched = input.employees.some((employee) => {
        if (reference.employeeNo && normalize(reference.employeeNo) === normalize(employee.employeeNo)) return true;
        if (!reference.name) return false;
        return normalize(reference.name) === normalize(`${employee.firstName} ${employee.lastName}`);
      });

      if (!matched) {
        issues.push({
          id: `reference-unmatched-${reference.employeeNo || normalize(reference.name ?? "unknown")}`,
          severity: "medium",
          code: "REFERENCE_UNMATCHED",
          title: "Imported payroll row could not be matched",
          detail: `${reference.employeeNo || reference.name || "A row"} exists in the imported payroll but not in this run's employee scope.`,
        });
      }
    }
  }

  const highCount = issues.filter((issue) => issue.severity === "high").length;
  const mediumCount = issues.filter((issue) => issue.severity === "medium").length;
  const exceptionCount = input.entries.filter((entry) => entry.status.toLowerCase() === "exception").length;
  const approvalStatus = input.approvalTask?.status;

  const checks: PayrollReadiness["checks"] = [
    {
      key: "calculated",
      label: "Payroll calculated",
      state: input.entries.length ? "pass" : "blocked",
      detail: input.entries.length ? `${input.entries.length} employee entries calculated.` : "Calculate this payroll run first.",
    },
    {
      key: "exceptions",
      label: "Engine exceptions reviewed",
      state: exceptionCount ? "review" : "pass",
      detail: exceptionCount ? `${exceptionCount} engine exception${exceptionCount === 1 ? "" : "s"} still need review.` : "No engine exceptions are open.",
    },
    {
      key: "audit",
      label: "Payroll auditor",
      state: highCount ? "blocked" : mediumCount ? "review" : "pass",
      detail: highCount
        ? `${highCount} blocking issue${highCount === 1 ? "" : "s"} found.`
        : mediumCount
          ? `${mediumCount} review item${mediumCount === 1 ? "" : "s"} found.`
          : "No configured payroll audit checks triggered.",
    },
    {
      key: "approval",
      label: "Maker-checker approval",
      state: !input.approvalTask
        ? "optional"
        : approvalStatus === "Approved"
          ? "pass"
          : approvalStatus === "Declined"
            ? "blocked"
            : "review",
      detail: !input.approvalTask
        ? "No approval task is configured for this run."
        : approvalStatus === "Approved"
          ? `Approved by the configured approval chain.`
          : approvalStatus === "Declined"
            ? "The payroll approval was declined."
            : `Waiting for ${input.approvalTask.approver}.`,
    },
    {
      key: "parallel",
      label: "Parallel Payroll",
      state: input.parallelRows?.length
        ? issues.some((issue) => issue.code === "PARALLEL_VARIANCE" && issue.severity === "high")
          ? "blocked"
          : issues.some((issue) => issue.code === "PARALLEL_VARIANCE")
            ? "review"
            : "pass"
        : "optional",
      detail: input.parallelRows?.length
        ? `${input.parallelRows.length} imported payroll row${input.parallelRows.length === 1 ? "" : "s"} compared.`
        : "Optional: import the payroll from your current system for an independent comparison.",
    },
  ];

  const blocked = checks.some((check) => check.state === "blocked");
  const review = checks.some((check) => check.state === "review");

  return {
    issues,
    variances,
    readiness: {
      verdict: blocked ? "blocked" : review ? "review" : "ready",
      label: blocked ? "Blocked" : review ? "Review required" : "Ready for release",
      highCount,
      mediumCount,
      checks,
    },
  };
}

export function explainPayrollEntry(input: {
  entry: PayrollControlEntry;
  employee?: PayrollControlEmployee;
  previousEntry?: PayrollControlEntry;
  parallelRow?: ParallelPayrollRow;
}) {
  const currentLines = lineItems(input.entry);
  const previousLines = input.previousEntry ? lineItems(input.previousEntry) : [];
  const previousByCode = new Map<string, number>();

  for (const line of previousLines) {
    previousByCode.set(line.code, (previousByCode.get(line.code) ?? 0) + line.amount);
  }

  const changes = currentLines
    .map((line) => ({
      code: line.code,
      label: line.label,
      current: round2(line.amount),
      previous: round2(previousByCode.get(line.code) ?? 0),
      delta: round2(line.amount - (previousByCode.get(line.code) ?? 0)),
    }))
    .filter((line) => Math.abs(line.delta) >= 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const currentNet = numberOf(input.entry.netPay);
  const previousNet = input.previousEntry ? numberOf(input.previousEntry.netPay) : null;
  const referenceNet = input.parallelRow?.netPay ?? null;

  return {
    employeeName: employeeName(input.employee) ?? `Employee #${input.entry.employeeId}`,
    employeeNo: input.employee?.employeeNo ?? String(input.entry.employeeId),
    grossPay: numberOf(input.entry.grossPay),
    deductions: numberOf(input.entry.deductions),
    netPay: currentNet,
    previousNet,
    previousDelta: previousNet === null ? null : round2(currentNet - previousNet),
    referenceNet,
    referenceDelta: referenceNet === null ? null : round2(currentNet - referenceNet),
    lineItems: currentLines,
    changes,
    flags: traceFlags(input.entry),
  };
}
