export type LaborAllocationRow = {
  id: number;
  employeeId: number;
  costCenterId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  allocationPercent: number | string;
  allocationBasis: string;
  projectCode?: string | null;
  clientCode?: string | null;
  jobCode?: string | null;
};

export type ResolvedLaborAllocation = {
  status: "allocated" | "unallocated";
  asOf: string;
  totalPercent: number;
  allocations: Array<{
    id: number;
    costCenterId: number;
    percent: number;
    projectCode: string | null;
    clientCode: string | null;
    jobCode: string | null;
  }>;
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

/**
 * Resolve the employee's percentage-based labor allocation for a single date.
 *
 * This is intentionally fail-closed. Once an employee has active costing rows,
 * the active set must reconcile to 100.000%; payroll/finance reporting must not
 * silently normalize an incomplete or over-allocated configuration.
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
      totalPercent: 0,
      allocations: [],
    };
  }

  const seen = new Set<string>();
  const allocations = active.map((row) => {
    if (row.allocationBasis !== "percentage") {
      throw new Error(`Unsupported labor allocation basis "${row.allocationBasis}" for allocation #${row.id}.`);
    }

    const percent = Number(row.allocationPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new Error(`Invalid labor allocation percent for allocation #${row.id}.`);
    }

    const key = dimensionKey(row);
    if (seen.has(key)) {
      throw new Error(`Duplicate active labor allocation dimension for employee #${input.employeeId} on ${input.asOf}.`);
    }
    seen.add(key);

    return {
      id: row.id,
      costCenterId: row.costCenterId,
      percent: round3(percent),
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
    totalPercent,
    allocations,
  };
}

export function laborAllocationTrace(resolved: ResolvedLaborAllocation) {
  return {
    status: resolved.status,
    asOf: resolved.asOf,
    totalPercent: resolved.totalPercent,
    allocations: resolved.allocations.map((row) => ({
      allocationId: row.id,
      costCenterId: row.costCenterId,
      percent: row.percent,
      clientCode: row.clientCode,
      projectCode: row.projectCode,
      jobCode: row.jobCode,
    })),
  };
}


export type LaborHoursRow = {
  id: number;
  employeeId: number;
  costCenterId: number;
  workDate: string;
  minutes: number;
  projectCode?: string | null;
  clientCode?: string | null;
  jobCode?: string | null;
};

export type ResolvedHoursLaborAllocation = {
  status: "allocated" | "unallocated";
  allocationBasis: "hours";
  workDate: string;
  totalMinutes: number;
  allocations: Array<{
    id: number;
    costCenterId: number;
    minutes: number;
    percent: number;
    projectCode: string | null;
    clientCode: string | null;
    jobCode: string | null;
  }>;
};

export type EmployerCostComponent =
  | "gross_pay"
  | "employer_sss"
  | "employer_ec"
  | "employer_philhealth"
  | "employer_pagibig";

export type LaborCostAllocationLine = {
  component: EmployerCostComponent;
  amount: number;
  costCenterId: number;
  minutes: number;
  projectCode: string | null;
  clientCode: string | null;
  jobCode: string | null;
};

export type LaborGlMappingRow = {
  id: number;
  legalEntityId: number;
  costCenterId: number;
  component: EmployerCostComponent;
  glAccountCode: string;
  glAccountName: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
};

function hourDimensionKey(row: LaborHoursRow) {
  return [
    row.costCenterId,
    row.projectCode ?? "",
    row.clientCode ?? "",
    row.jobCode ?? "",
  ].join("|");
}

function round6(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

/**
 * Resolve actual recorded minutes into deterministic costing weights.
 *
 * This does not infer time from scheduled hours. Hours-based costing must be
 * backed by explicit actual allocation evidence for the payroll work date.
 */
export function resolveHoursBasedLaborAllocation(input: {
  employeeId: number;
  workDate: string;
  rows: LaborHoursRow[];
}): ResolvedHoursLaborAllocation {
  const active = input.rows
    .filter((row) => row.employeeId === input.employeeId && row.workDate === input.workDate)
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
      allocationBasis: "hours",
      workDate: input.workDate,
      totalMinutes: 0,
      allocations: [],
    };
  }

  const seen = new Set<string>();
  for (const row of active) {
    if (!Number.isInteger(row.minutes) || row.minutes <= 0 || row.minutes > 2_880) {
      throw new Error(`Invalid labor allocation minutes for allocation #${row.id}.`);
    }
    const key = hourDimensionKey(row);
    if (seen.has(key)) {
      throw new Error(
        `Duplicate hours-based labor allocation dimension for employee #${input.employeeId} on ${input.workDate}.`,
      );
    }
    seen.add(key);
  }

  const totalMinutes = active.reduce((sum, row) => sum + row.minutes, 0);
  const preliminary = active.map((row) => ({
    id: row.id,
    costCenterId: row.costCenterId,
    minutes: row.minutes,
    percent: round6((row.minutes / totalMinutes) * 100),
    projectCode: row.projectCode ?? null,
    clientCode: row.clientCode ?? null,
    jobCode: row.jobCode ?? null,
  }));

  // Keep the displayed percentage trace exactly reconciling to 100 without
  // using the rounded percentages for money allocation.
  const priorPercent = preliminary
    .slice(0, -1)
    .reduce((sum, row) => sum + row.percent, 0);
  if (preliminary.length > 0) {
    preliminary[preliminary.length - 1]!.percent = round6(100 - priorPercent);
  }

  return {
    status: "allocated",
    allocationBasis: "hours",
    workDate: input.workDate,
    totalMinutes,
    allocations: preliminary,
  };
}

function moneyToCents(value: number | string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("Labor cost amount must be a finite non-negative value.");
  }

  // Normalize harmless binary noise before exact cent conversion. Production
  // payroll values are already currency amounts, but this also handles callers
  // passing a computed number such as 266.665.
  const normalized = typeof value === "number"
    ? value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "")
    : String(value).trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("Labor cost amount is not a valid decimal value.");

  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(3, "0");
  let cents = whole * 100n + BigInt(fraction.slice(0, 2) || "0");
  if (Number(fraction[2] ?? "0") >= 5) cents += 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Labor cost amount exceeds the supported accounting range.");
  }
  return cents;
}

function allocateCentsByMinutes(
  cents: bigint,
  resolved: ResolvedHoursLaborAllocation,
) {
  if (resolved.status !== "allocated" || resolved.totalMinutes <= 0) {
    if (cents === 0n) return [];
    throw new Error("Hours-based labor cost cannot be allocated without recorded minutes.");
  }

  const totalMinutes = BigInt(resolved.totalMinutes);
  const rows = resolved.allocations.map((allocation, index) => {
    const weighted = cents * BigInt(allocation.minutes);
    return {
      index,
      allocation,
      cents: weighted / totalMinutes,
      remainder: weighted % totalMinutes,
    };
  });

  let assigned = rows.reduce((sum, row) => sum + row.cents, 0n);
  let remainderCents = cents - assigned;
  const remainderOrder = [...rows].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  for (const row of remainderOrder) {
    if (remainderCents <= 0n) break;
    row.cents += 1n;
    remainderCents -= 1n;
    assigned += 1n;
  }

  if (assigned !== cents || remainderCents !== 0n) {
    throw new Error("Labor cost cent allocation did not reconcile.");
  }

  return rows
    .sort((a, b) => a.index - b.index)
    .map((row) => ({
      ...row.allocation,
      amount: Number(row.cents) / 100,
    }));
}

/**
 * Allocate authoritative payroll costs by actual minutes. This function never
 * calculates statutory contributions; it only distributes amounts already
 * produced by the payroll engine.
 */
export function allocatePayrollCostByHours(input: {
  allocation: ResolvedHoursLaborAllocation;
  grossPay: number | string;
  employerSss: number | string;
  employerEc: number | string;
  employerPhilHealth: number | string;
  employerPagIbig: number | string;
}): LaborCostAllocationLine[] {
  const components: Array<[EmployerCostComponent, number | string]> = [
    ["gross_pay", input.grossPay],
    ["employer_sss", input.employerSss],
    ["employer_ec", input.employerEc],
    ["employer_philhealth", input.employerPhilHealth],
    ["employer_pagibig", input.employerPagIbig],
  ];

  const lines: LaborCostAllocationLine[] = [];
  for (const [component, value] of components) {
    const cents = moneyToCents(value);
    for (const allocated of allocateCentsByMinutes(cents, input.allocation)) {
      lines.push({
        component,
        amount: allocated.amount,
        costCenterId: allocated.costCenterId,
        minutes: allocated.minutes,
        projectCode: allocated.projectCode,
        clientCode: allocated.clientCode,
        jobCode: allocated.jobCode,
      });
    }
  }
  return lines;
}

export function buildLaborCostGlPostings(input: {
  legalEntityId: number;
  asOf: string;
  lines: LaborCostAllocationLine[];
  mappings: LaborGlMappingRow[];
}) {
  return input.lines.map((line) => {
    const matches = input.mappings.filter((mapping) =>
      mapping.active
      && mapping.legalEntityId === input.legalEntityId
      && mapping.costCenterId === line.costCenterId
      && mapping.component === line.component
      && mapping.effectiveFrom <= input.asOf
      && (!mapping.effectiveUntil || input.asOf <= mapping.effectiveUntil),
    );

    if (matches.length === 0) {
      throw new Error(
        `Missing GL mapping for legal entity #${input.legalEntityId}, cost center #${line.costCenterId}, component ${line.component} on ${input.asOf}.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Overlapping GL mappings for legal entity #${input.legalEntityId}, cost center #${line.costCenterId}, component ${line.component} on ${input.asOf}.`,
      );
    }

    const mapping = matches[0]!;
    return {
      ...line,
      legalEntityId: input.legalEntityId,
      glMappingId: mapping.id,
      glAccountCode: mapping.glAccountCode,
      glAccountName: mapping.glAccountName,
    };
  });
}
