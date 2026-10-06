export type LaborAllocationBasis = "percentage" | "hours";

export type LaborAllocationRow = {
  id: number;
  employeeId: number;
  costCenterId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  allocationPercent: number | string;
  allocationBasis: string;
  allocationHours?: number | string | null;
  projectCode?: string | null;
  clientCode?: string | null;
  jobCode?: string | null;
};

export type ResolvedLaborAllocation = {
  status: "allocated" | "unallocated";
  asOf: string;
  basis: LaborAllocationBasis | null;
  totalPercent: number;
  totalHours: number | null;
  allocations: Array<{
    id: number;
    costCenterId: number;
    percent: number;
    hours: number | null;
    projectCode: string | null;
    clientCode: string | null;
    jobCode: string | null;
  }>;
};

export const LABOR_GL_ACCOUNT_KEYS = [
  "salary_expense",
  "reimbursements_expense",
  "de_minimis_expense",
  "sss_employer_expense",
  "ec_employer_expense",
  "philhealth_employer_expense",
  "pagibig_employer_expense",
  "sss_employee_payable",
  "sss_employer_payable",
  "ec_payable",
  "philhealth_employee_payable",
  "philhealth_employer_payable",
  "pagibig_employee_payable",
  "pagibig_voluntary_payable",
  "pagibig_employer_payable",
  "bir_withholding_payable",
  "government_loans_payable",
  "company_loan_receivable",
  "employee_advances_receivable",
  "employee_benefits_payable",
  "cash_bank",
] as const;

export type LaborGlAccountKey = (typeof LABOR_GL_ACCOUNT_KEYS)[number];

export type LaborGlMappingRow = {
  id: number;
  legalEntityId: number | null;
  costCenterId: number | null;
  accountKey: string;
  accountCode?: string | null;
  accountName: string;
  active: boolean;
};

function dimensionKey(row: LaborAllocationRow) {
  return [
    row.costCenterId,
    row.projectCode ?? "",
    row.clientCode ?? "",
    row.jobCode ?? "",
  ].join("|");
}

function round3(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve the employee's effective labor allocation for a single date.
 *
 * Percentage plans must reconcile to exactly 100%. Hours plans preserve the
 * entered hours and deterministically normalize them to 100% so downstream
 * payroll/accounting code can keep consuming the same allocation contract.
 *
 * This remains fail-closed: mixed bases, duplicate dimensions, invalid hours,
 * or invalid percentages are rejected rather than silently normalized.
 */
export function resolveLaborAllocation(input: {
  employeeId: number;
  asOf: string;
  rows: LaborAllocationRow[];
}): ResolvedLaborAllocation {
  const active = input.rows
    .filter((row) =>
      row.employeeId === input.employeeId
      && row.effectiveFrom <= input.asOf
      && (!row.effectiveUntil || input.asOf <= row.effectiveUntil),
    )
    .sort((a, b) =>
      a.costCenterId - b.costCenterId
      || String(a.clientCode ?? "").localeCompare(String(b.clientCode ?? ""))
      || String(a.projectCode ?? "").localeCompare(String(b.projectCode ?? ""))
      || String(a.jobCode ?? "").localeCompare(String(b.jobCode ?? ""))
      || a.id - b.id,
    );

  if (active.length === 0) {
    return {
      status: "unallocated",
      asOf: input.asOf,
      basis: null,
      totalPercent: 0,
      totalHours: null,
      allocations: [],
    };
  }

  const bases = new Set(active.map((row) => row.allocationBasis || "percentage"));
  if (bases.size !== 1) {
    throw new Error(`Mixed labor allocation bases for employee #${input.employeeId} on ${input.asOf}.`);
  }
  const basis = [...bases][0];
  if (basis !== "percentage" && basis !== "hours") {
    throw new Error(`Unsupported labor allocation basis "${basis}" for employee #${input.employeeId}.`);
  }

  const seen = new Set<string>();
  for (const row of active) {
    const key = dimensionKey(row);
    if (seen.has(key)) {
      throw new Error(`Duplicate active labor allocation dimension for employee #${input.employeeId} on ${input.asOf}.`);
    }
    seen.add(key);
  }

  if (basis === "percentage") {
    const allocations = active.map((row) => {
      const percent = Number(row.allocationPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new Error(`Invalid labor allocation percent for allocation #${row.id}.`);
      }
      return {
        id: row.id,
        costCenterId: row.costCenterId,
        percent: round3(percent),
        hours: null,
        projectCode: row.projectCode ?? null,
        clientCode: row.clientCode ?? null,
        jobCode: row.jobCode ?? null,
      };
    });

    const totalPercent = round3(allocations.reduce((sum, row) => sum + row.percent, 0));
    if (Math.abs(totalPercent - 100) > 0.001) {
      throw new Error(
        `Labor allocation for employee #${input.employeeId} on ${input.asOf} totals ${totalPercent.toFixed(3)}%, expected 100.000%.`,
      );
    }

    return {
      status: "allocated",
      asOf: input.asOf,
      basis,
      totalPercent,
      totalHours: null,
      allocations,
    };
  }

  const hours = active.map((row) => {
    const value = Number(row.allocationHours);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid labor allocation hours for allocation #${row.id}.`);
    }
    return round3(value);
  });
  const totalHours = round3(hours.reduce((sum, value) => sum + value, 0));
  if (totalHours <= 0) {
    throw new Error(`Labor allocation hours for employee #${input.employeeId} must be greater than zero.`);
  }

  const allocations = active.map((row, index) => ({
    id: row.id,
    costCenterId: row.costCenterId,
    percent: round3((hours[index]! / totalHours) * 100),
    hours: hours[index]!,
    projectCode: row.projectCode ?? null,
    clientCode: row.clientCode ?? null,
    jobCode: row.jobCode ?? null,
  }));
  const roundedTotal = round3(allocations.reduce((sum, row) => sum + row.percent, 0));
  if (allocations.length > 0 && roundedTotal !== 100) {
    allocations[allocations.length - 1]!.percent = round3(
      allocations[allocations.length - 1]!.percent + (100 - roundedTotal),
    );
  }

  return {
    status: "allocated",
    asOf: input.asOf,
    basis,
    totalPercent: 100,
    totalHours,
    allocations,
  };
}

export function allocateLaborAmount(amount: number, resolved: ResolvedLaborAllocation) {
  if (!Number.isFinite(amount)) throw new Error("Labor-cost amount must be finite.");
  if (resolved.status !== "allocated" || resolved.allocations.length === 0) {
    return [{
      allocationId: null,
      costCenterId: null,
      percent: 100,
      hours: null,
      clientCode: null,
      projectCode: null,
      jobCode: null,
      amount: round2(amount),
    }];
  }

  const totalCents = Math.round((amount + Number.EPSILON) * 100);
  let allocatedCents = 0;
  return resolved.allocations.map((row, index) => {
    const cents = index === resolved.allocations.length - 1
      ? totalCents - allocatedCents
      : Math.round(totalCents * (row.percent / 100));
    allocatedCents += cents;
    return {
      allocationId: row.id,
      costCenterId: row.costCenterId,
      percent: row.percent,
      hours: row.hours,
      clientCode: row.clientCode,
      projectCode: row.projectCode,
      jobCode: row.jobCode,
      amount: cents / 100,
    };
  });
}

export function resolveLaborGlAccount(input: {
  mappings: LaborGlMappingRow[];
  legalEntityId: number | null;
  costCenterId: number | null;
  accountKey: LaborGlAccountKey;
  fallbackName: string;
}) {
  const eligible = input.mappings
    .filter((row) =>
      row.active
      && row.accountKey === input.accountKey
      && (row.legalEntityId === null || row.legalEntityId === input.legalEntityId)
      && (row.costCenterId === null || row.costCenterId === input.costCenterId),
    )
    .map((row) => ({
      row,
      rank:
        (row.legalEntityId !== null ? 2 : 0)
        + (row.costCenterId !== null ? 1 : 0),
    }))
    .sort((a, b) => b.rank - a.rank || a.row.id - b.row.id);

  const mapping = eligible[0]?.row;
  return {
    mappingId: mapping?.id ?? null,
    accountCode: mapping?.accountCode ?? null,
    accountName: mapping?.accountName ?? input.fallbackName,
  };
}

export function laborAllocationTrace(resolved: ResolvedLaborAllocation) {
  return {
    status: resolved.status,
    asOf: resolved.asOf,
    basis: resolved.basis,
    totalPercent: resolved.totalPercent,
    totalHours: resolved.totalHours,
    allocations: resolved.allocations.map((row) => ({
      allocationId: row.id,
      costCenterId: row.costCenterId,
      percent: row.percent,
      hours: row.hours,
      clientCode: row.clientCode,
      projectCode: row.projectCode,
      jobCode: row.jobCode,
    })),
  };
}
