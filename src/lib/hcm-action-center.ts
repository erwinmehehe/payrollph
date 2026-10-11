/**
 * Minimal HCM action-center contracts. These utilities are safe to import in a
 * client component and never query or mutate payroll, workers or decisions.
 */
export const HCM_BP_SCAN_LIMIT = 120;
export const HCM_BP_HISTORY_LIMIT = 25;

export function canReadCompanyHcmHistory(access: {
  companyWide: boolean;
  role: string;
} | null | undefined): boolean {
  return Boolean(access?.companyWide && ["owner", "admin", "hr"].includes(access.role));
}

/** Keep source keys, frozen process evidence, notes and private snapshots off the wire. */
export function projectHcmProcessSummary(row: {
  id: number;
  processType: string;
  status: string;
  effectiveDate: string | null;
  initiatedByName: string;
  initiatedAt: Date | string;
  completedAt: Date | string | null;
  employeeId: number | null;
  definitionSnapshot: unknown;
}) {
  const snapshot = row.definitionSnapshot;
  const rawName = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).name
    : null;
  const processName = typeof rawName === "string" && rawName.trim()
    ? rawName.trim().slice(0, 160) : row.processType;
  const instant = (value: Date | string | null): string | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };
  return {
    id: row.id,
    processType: row.processType,
    processName,
    status: row.status,
    effectiveDate: row.effectiveDate,
    initiatedByName: row.initiatedByName,
    initiatedAt: instant(row.initiatedAt),
    completedAt: instant(row.completedAt),
    employeeId: row.employeeId,
  };
}

/**
 * A declined review is terminal, NOT a silent send-back or permission to
 * resubmit the same frozen source. Its rationale is kept on the governed step.
 */
export function reviewDeclineError(
  action: string, stepType: string, note: unknown,
): string | null {
  if (action !== "decline" || stepType !== "review") return null;
  if (typeof note !== "string" || note.trim().length < 10 || note.trim().length > 500) {
    return "A review decline requires a reason of 10–500 characters. Submit a fresh governed request after correction.";
  }
  return null;
}
