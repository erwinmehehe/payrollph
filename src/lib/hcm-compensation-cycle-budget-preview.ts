/**
 * Read-only compensation-cycle budget preview.
 *
 * Only the governed server may reserve/approve/commit budget. A client
 * snapshot is never authority to schedule a pay revision or release payroll.
 * Currency strings use integer cent arithmetic to avoid float drift.
 */
export type CompensationCycleBudgetInput = {
  id: number;
  budgetPool: string;
};

export type CompensationBudgetProposalInput = {
  id: number;
  cycleId: number;
  status: string;
  currentAnnual: string;
  proposedAnnual: string;
};

export type CompensationBudgetPreview =
  | { state: "unavailable"; reason: string }
  | {
      state: "available";
      committedAnnual: number;
      pendingAnnual: number;
      remainingAnnual: number;
      overCommittedAnnual: number;
      potentialOverBudgetAnnual: number;
      committedCount: number;
      pendingCount: number;
      /** Only source server actions can make a pay or budget decision. */
      authorizesCompensation: false;
    };

function toCents(value: string): number | null {
  if (typeof value !== "string") return null;
  const matched = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!matched) return null;
  const whole = Number(matched[1]);
  const fraction = Number((matched[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function safeAdd(a: number, b: number): number | null {
  const total = a + b;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

const COMMITTED = new Set(["scheduled", "applied"]);
const PENDING = new Set(["proposed"]);
const INACTIVE = new Set(["cancelled", "rejected", "declined", "failed"]);

export function summarizeCompensationCycleBudget(
  cycle: CompensationCycleBudgetInput | null,
  proposals: readonly CompensationBudgetProposalInput[],
): CompensationBudgetPreview | null {
  if (!cycle) return null;
  if (!Number.isSafeInteger(cycle.id) || cycle.id <= 0) {
    return { state: "unavailable", reason: "Invalid compensation cycle identifier." };
  }
  const poolCents = toCents(cycle.budgetPool);
  if (poolCents === null) {
    return { state: "unavailable", reason: "Cycle budget is not a valid source amount." };
  }

  let committed = 0;
  let pending = 0;
  let committedCount = 0;
  let pendingCount = 0;
  const seen = new Set<number>();
  for (const proposal of proposals) {
    if (proposal.cycleId !== cycle.id) continue;
    if (!Number.isSafeInteger(proposal.id) || proposal.id <= 0 ||
        seen.has(proposal.id)) {
      return { state: "unavailable", reason: "Duplicate or invalid proposal data." };
    }
    seen.add(proposal.id);
    if (INACTIVE.has(proposal.status)) continue;
    if (!COMMITTED.has(proposal.status) && !PENDING.has(proposal.status)) {
      return { state: "unavailable", reason: "Unknown compensation proposal status." };
    }
    const before = toCents(proposal.currentAnnual);
    const after = toCents(proposal.proposedAnnual);
    if (before === null || after === null) {
      return { state: "unavailable", reason: "Proposal amounts need review." };
    }
    const increase = Math.max(0, after - before);
    if (COMMITTED.has(proposal.status)) {
      const total = safeAdd(committed, increase);
      if (total === null) {
        return { state: "unavailable", reason: "Committed totals exceed supported precision." };
      }
      committed = total;
      committedCount++;
    } else {
      const total = safeAdd(pending, increase);
      if (total === null) {
        return { state: "unavailable", reason: "Pending totals exceed supported precision." };
      }
      pending = total;
      pendingCount++;
    }
  }
  const possibleTotal = safeAdd(committed, pending);
  if (possibleTotal === null) {
    return { state: "unavailable", reason: "Total proposal exposure exceeds supported precision." };
  }
  return {
    state: "available",
    committedAnnual: committed / 100,
    pendingAnnual: pending / 100,
    remainingAnnual: (poolCents - committed) / 100,
    overCommittedAnnual: Math.max(0, committed - poolCents) / 100,
    potentialOverBudgetAnnual: Math.max(0, possibleTotal - poolCents) / 100,
    committedCount,
    pendingCount,
    authorizesCompensation: false,
  };
}
