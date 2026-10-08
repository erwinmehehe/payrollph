import type { EmployeeVariance, PayrollComponentBreakdown } from "@/lib/payroll-assurance";

export type ParallelComponentKey = keyof PayrollComponentBreakdown;

export type ParallelPayrollEmployee = {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
};

export type ParallelComponentComparison = {
  key: ParallelComponentKey;
  label: string;
  existing: number | null;
  linaw: number;
  delta: number | null;
  percent: number | null;
  different: boolean;
};

export type ParallelPayrollRow = {
  employeeId: number;
  employeeNo: string;
  name: string;
  components: ParallelComponentComparison[];
  differenceCount: number;
  largestAbsoluteDelta: number;
};

export type ParallelPayrollResult = {
  rows: ParallelPayrollRow[];
  detected: ParallelComponentKey[];
  unmatchedEmployeeNumbers: string[];
  skippedRows: number;
};

const COMPONENTS: Array<{
  key: ParallelComponentKey;
  label: string;
  deduction: boolean;
  candidates: string[];
}> = [
  {
    key: "gross",
    label: "Gross pay",
    deduction: false,
    candidates: ["existing_gross_pay", "gross_pay", "gross pay", "gross"],
  },
  {
    key: "sss",
    label: "SSS",
    deduction: true,
    candidates: ["sss", "sss_employee", "sss contribution", "sss_contribution", "sss deduction"],
  },
  {
    key: "philHealth",
    label: "PhilHealth",
    deduction: true,
    candidates: ["philhealth", "phil_health", "phic", "philhealth contribution", "philhealth_contribution"],
  },
  {
    key: "pagIbig",
    label: "Pag-IBIG",
    deduction: true,
    candidates: ["pagibig", "pag_ibig", "pag-ibig", "hdmf", "pagibig contribution", "pagibig_contribution"],
  },
  {
    key: "withholdingTax",
    label: "Withholding tax",
    deduction: true,
    candidates: ["withholding_tax", "withholding tax", "wht", "income_tax", "income tax", "tax"],
  },
  {
    key: "otherDeductions",
    label: "Other deductions",
    deduction: true,
    candidates: ["other_deductions", "other deductions", "other_deduction", "other deduction"],
  },
  {
    key: "net",
    label: "Net pay",
    deduction: false,
    candidates: ["existing_net_pay", "existing net pay", "net_pay", "net pay", "net"],
  },
];

const EMPLOYEE_COLUMNS = [
  "employee_no",
  "employee_number",
  "employee number",
  "employee id",
  "employee_id",
  "employee",
];

const TOTAL_DEDUCTION_COLUMNS = [
  "total_deductions",
  "total deductions",
  "deductions",
  "deduction_total",
  "deduction total",
];

export function normalizeParallelHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function findParallelColumn(columns: string[], candidates: string[]) {
  const normalized = new Map(columns.map((column) => [normalizeParallelHeader(column), column]));
  for (const candidate of candidates) {
    const found = normalized.get(normalizeParallelHeader(candidate));
    if (found) return found;
  }
  return null;
}

export function parseParallelMoney(value: unknown) {
  const cleaned = String(value ?? "")
    .replace(/[₱$\s]/g, "")
    .replace(/,/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percent(delta: number, existing: number) {
  if (existing === 0) return delta === 0 ? 0 : null;
  return round((delta / Math.abs(existing)) * 100);
}

export function buildParallelPayrollComparison(input: {
  records: Array<Record<string, string>>;
  employees: ParallelPayrollEmployee[];
  comparisons: EmployeeVariance[];
}): ParallelPayrollResult {
  const { records, employees, comparisons } = input;
  if (records.length === 0) {
    return { rows: [], detected: [], unmatchedEmployeeNumbers: [], skippedRows: 0 };
  }

  const columns = Object.keys(records[0]);
  const employeeColumn = findParallelColumn(columns, EMPLOYEE_COLUMNS);
  if (!employeeColumn) {
    throw new Error("CSV needs an employee number column.");
  }

  const columnByComponent = new Map<ParallelComponentKey, string>();
  for (const component of COMPONENTS) {
    const column = findParallelColumn(columns, component.candidates);
    if (column) columnByComponent.set(component.key, column);
  }

  const totalDeductionsColumn = findParallelColumn(columns, TOTAL_DEDUCTION_COLUMNS);
  const detected = COMPONENTS
    .filter((component) => columnByComponent.has(component.key))
    .map((component) => component.key);

  if (detected.length === 0) {
    throw new Error(
      "CSV needs at least one payroll amount column such as gross_pay, sss, philhealth, pagibig, withholding_tax, other_deductions, or net_pay.",
    );
  }

  const employeeByNo = new Map(
    employees.map((employee) => [employee.employeeNo.trim().toLowerCase(), employee]),
  );
  const comparisonByEmployee = new Map(
    comparisons.map((comparison) => [comparison.employeeId, comparison]),
  );

  const rows: ParallelPayrollRow[] = [];
  const unmatchedEmployeeNumbers: string[] = [];
  let skippedRows = 0;

  for (const record of records) {
    const employeeNo = String(record[employeeColumn] ?? "").trim();
    if (!employeeNo) {
      skippedRows += 1;
      continue;
    }

    const employee = employeeByNo.get(employeeNo.toLowerCase());
    if (!employee) {
      unmatchedEmployeeNumbers.push(employeeNo);
      continue;
    }

    const comparison = comparisonByEmployee.get(employee.id);
    if (!comparison) {
      skippedRows += 1;
      continue;
    }

    const existingValues = new Map<ParallelComponentKey, number | null>();
    for (const component of COMPONENTS) {
      const column = columnByComponent.get(component.key);
      if (!column) {
        existingValues.set(component.key, null);
        continue;
      }
      const parsed = parseParallelMoney(record[column]);
      existingValues.set(
        component.key,
        parsed == null ? null : round(component.deduction ? Math.abs(parsed) : parsed),
      );
    }

    if (
      existingValues.get("otherDeductions") == null &&
      totalDeductionsColumn
    ) {
      const standardDeductionKeys = ["sss", "philHealth", "pagIbig", "withholdingTax"] as ParallelComponentKey[];
      const standardDeductions = standardDeductionKeys.map((key) => existingValues.get(key));
      const canDeriveOther = standardDeductions.every((value): value is number => value != null);
      const totalDeductions = parseParallelMoney(record[totalDeductionsColumn]);

      if (canDeriveOther && totalDeductions != null) {
        const statutoryAndTax = standardDeductions.reduce((sum, value) => sum + Math.abs(value), 0);
        existingValues.set(
          "otherDeductions",
          round(Math.max(0, Math.abs(totalDeductions) - statutoryAndTax)),
        );
        if (!detected.includes("otherDeductions")) detected.push("otherDeductions");
      }
    }

    const components = COMPONENTS.flatMap((component) => {
      const existing = existingValues.get(component.key) ?? null;
      if (existing == null) return [];

      const linaw = round(comparison.currentComponents[component.key]);
      const delta = round(linaw - existing);
      return [{
        key: component.key,
        label: component.label,
        existing,
        linaw,
        delta,
        percent: percent(delta, existing),
        different: Math.abs(Math.round(delta * 100)) > 1,
      } satisfies ParallelComponentComparison];
    });

    if (components.length === 0) {
      skippedRows += 1;
      continue;
    }

    rows.push({
      employeeId: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      components,
      differenceCount: components.filter((component) => component.different).length,
      largestAbsoluteDelta: Math.max(...components.map((component) => Math.abs(component.delta ?? 0))),
    });
  }

  rows.sort((a, b) => {
    if (b.differenceCount !== a.differenceCount) return b.differenceCount - a.differenceCount;
    return b.largestAbsoluteDelta - a.largestAbsoluteDelta;
  });

  return {
    rows,
    detected: [...new Set(detected)],
    unmatchedEmployeeNumbers: [...new Set(unmatchedEmployeeNumbers)],
    skippedRows,
  };
}

export function parallelComponentLabel(key: ParallelComponentKey) {
  return COMPONENTS.find((component) => component.key === key)?.label ?? key;
}
