/**
 * Read-only manager projection of an employee's schedule content receipts.
 * A missing acknowledgment is not attendance evidence or a payroll exception.
 */
export type ManagerReceiptDay = {
  date: string;
  state: "pending" | "acknowledged" | "changed" | "unavailable";
  acknowledgedAt: string | null;
};

export type ManagerReceiptSummary = {
  acknowledged: number;
  pending: number;
  changed: number;
  unavailable: number;
};

export type ManagerReceiptAccount = "ready" | "not_enrolled" | "identity_review";

type Projected = { date: string; snapshotHash: string | null };
type Current = { workDate: string; snapshotHash: string; acknowledgedAt: Date };

/** Never return receipt hashes or historical snapshot contents to a manager. */
export function managerReceiptDays(
  projected: readonly Projected[],
  current: readonly Current[],
  historicalDates: ReadonlySet<string>,
): ManagerReceiptDay[] {
  if (projected.length !== 7 || new Set(projected.map(day => day.date)).size !== 7) {
    throw new Error("A complete seven-day current roster is required.");
  }
  return projected.map(day => {
    if (day.snapshotHash === null) {
      return { date: day.date, state: "unavailable" as const, acknowledgedAt: null };
    }
    if (!/^[a-f0-9]{64}$/.test(day.snapshotHash)) {
      throw new Error("Malformed current roster evidence.");
    }
    const match = current.find(row =>
      row.workDate === day.date && row.snapshotHash === day.snapshotHash);
    if (match) {
      if (!(match.acknowledgedAt instanceof Date) || !Number.isFinite(match.acknowledgedAt.getTime())) {
        throw new Error("Invalid receipt timestamp evidence.");
      }
      return {
        date: day.date, state: "acknowledged" as const,
        acknowledgedAt: match.acknowledgedAt.toISOString(),
      };
    }
    return {
      date: day.date,
      state: historicalDates.has(day.date) ? "changed" as const : "pending" as const,
      acknowledgedAt: null,
    };
  });
}

export function summarizeManagerReceiptDays(days: readonly ManagerReceiptDay[]): ManagerReceiptSummary {
  return {
    acknowledged: days.filter(day => day.state === "acknowledged").length,
    pending: days.filter(day => day.state === "pending").length,
    changed: days.filter(day => day.state === "changed").length,
    unavailable: days.filter(day => day.state === "unavailable").length,
  };
}
