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
