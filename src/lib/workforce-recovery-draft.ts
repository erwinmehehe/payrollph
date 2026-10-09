/**
 * Review-only WFM coverage automation. Source candidates have already passed
 * server-side role, qualification, site, leave and availability checks.
 * These suggestions NEVER write shifts, approve claims or alter payroll.
 */
export type RecoveryMode = "coverage" | "balanced";
export type RecoveryCandidate = {
  employeeId: number;
  employeeName: string;
  score: number;
  workloadRisk: "low" | "medium" | "high";
  scheduledMinutesInWindow: number;
};
export type RecoveryDemand = {
  requirementId: number;
  workDate: string;
  gap: number;
  startTime: string;
  endTime: string;
  spansMidnight?: boolean;
  paidMinutes: number;
  candidates: RecoveryCandidate[];
};
export type RecoveryProposal = {
  requirementId: number;
  employeeId: number;
  workDate: string;
  startTime: string;
  endTime: string;
  spansMidnight?: boolean;
};
export type RecoveryConflict = {
  code: "INVALID_SHIFT_WINDOW" | "DUPLICATE_EMPLOYEE_DAY" | "OVERLAPPING_EMPLOYEE_SHIFT";
  employeeId: number;
  workDate: string;
};
export type RecoveryDraft = {
  mode: RecoveryMode;
  fills: Array<{
    requirementId: number;
    workDate: string;
    employeeId: number;
    employeeName: string;
    score: number;
    workloadRisk: RecoveryCandidate["workloadRisk"];
    projectedWindowMinutes: number;
    explanation: string;
  }>;
  baselineGap: number;
  projectedGap: number;
  requirementsRecovered: number;
  requirementsStillAtRisk: number;
  avoidedHighRiskCandidates: number;
  avoidedConflictingAssignments: number;
  limitedToFiftyClaims: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const MAX_DRAFT_CLAIMS = 50;

export function recoveryShiftInterval(input: {
  workDate: string; startTime: string; endTime: string; spansMidnight?: boolean;
}): { start: number; end: number } | null {
  if (!DATE.test(input.workDate)) return null;
  const day = new Date(input.workDate + "T00:00:00Z");
  if (!Number.isFinite(day.getTime()) ||
      day.toISOString().slice(0, 10) !== input.workDate) return null;
  const start = CLOCK.exec(input.startTime);
  const end = CLOCK.exec(input.endTime);
  if (!start || !end) return null;
  const seconds = (match: RegExpExecArray) =>
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? "0");
  const begin = seconds(start);
  const finish = seconds(end);
  // A 24-hour zero-length shift is ambiguous; never fabricate duration.
  if (finish === begin) return null;
  // Explicit overnight with an end after the start implies >24 hours.
  if (input.spansMidnight && finish > begin) return null;
  const midnight = day.getTime();
  const startAt = midnight + begin * 1000;
  const endAt = midnight + finish * 1000 + (finish < begin ? 86_400_000 : 0);
  return endAt > startAt && endAt - startAt < 86_400_000
    ? { start: startAt, end: endAt } : null;
}

/** Reject user-tampered draft submissions that double book one worker. */
export function recoveryProposalConflict(
  proposals: RecoveryProposal[],
): RecoveryConflict | null {
  const seenDays = new Set<string>();
  const assigned = new Map<number, Array<{ start: number; end: number }>>();
  for (const row of proposals) {
    const range = recoveryShiftInterval(row);
    if (!Number.isSafeInteger(row.employeeId) || row.employeeId <= 0 || !range) {
      return { code: "INVALID_SHIFT_WINDOW", employeeId: row.employeeId, workDate: row.workDate };
    }
    const key = String(row.employeeId) + "|" + row.workDate;
    if (seenDays.has(key)) {
      return { code: "DUPLICATE_EMPLOYEE_DAY", employeeId: row.employeeId, workDate: row.workDate };
    }
    if ((assigned.get(row.employeeId) ?? []).some(other =>
      range.start < other.end && other.start < range.end)) {
      return { code: "OVERLAPPING_EMPLOYEE_SHIFT", employeeId: row.employeeId, workDate: row.workDate };
    }
    seenDays.add(key);
    assigned.set(row.employeeId, [...(assigned.get(row.employeeId) ?? []), range]);
  }
  return null;
}

/**
 * Scarcity-first matching to keep single-qualified-worker roles from losing
 * their only candidate to a flexible requirement. This is a deterministic
 * heuristic, not an exact labor optimization or a compliance ruling.
 */
export function planSmartRecoveryDraft(input: {
  requirements: RecoveryDemand[];
  mode?: RecoveryMode;
  allowHighWorkloadRisk?: boolean;
}): RecoveryDraft {
  const mode: RecoveryMode = input.mode === "balanced" ? "balanced" : "coverage";
  const allowHigh = Boolean(input.allowHighWorkloadRisk);
  const open = input.requirements.filter(row =>
    Number.isSafeInteger(row.requirementId) && row.requirementId > 0 &&
    Number.isSafeInteger(row.gap) && row.gap > 0);
  const baselineGap = open.reduce((total, row) => total + row.gap, 0);
  const eligible = (row: RecoveryDemand) => row.candidates.filter(candidate =>
    Number.isSafeInteger(candidate.employeeId) && candidate.employeeId > 0 &&
    Number.isFinite(candidate.score) && Number.isFinite(candidate.scheduledMinutesInWindow) &&
    candidate.scheduledMinutesInWindow >= 0 &&
    (allowHigh || candidate.workloadRisk !== "high"));

  // Demand with less candidate slack must be considered first, before broad
  // requirements can use scarce workers. Stable tie breaking aids audit.
  const ordered = [...open].sort((a, b) =>
    (eligible(a).length / a.gap) - (eligible(b).length / b.gap) ||
    eligible(a).length - eligible(b).length ||
    a.workDate.localeCompare(b.workDate) || a.requirementId - b.requirementId);

  const fills: RecoveryDraft["fills"] = [];
  const chosen: RecoveryProposal[] = [];
  const assignedMinutes = new Map<number, number>();
  let avoidedHighRiskCandidates = 0;
  let avoidedConflictingAssignments = 0;
  for (const row of ordered) {
    const range = recoveryShiftInterval(row);
    if (!range || !Number.isFinite(row.paidMinutes) ||
        row.paidMinutes <= 0 || row.paidMinutes > 24 * 60) continue;
    const candidates = eligible(row);
    for (let slot = 0; slot < row.gap && fills.length < MAX_DRAFT_CLAIMS; slot++) {
      const available = [...candidates].sort((a, b) => {
        const left = a.scheduledMinutesInWindow + (assignedMinutes.get(a.employeeId) ?? 0);
        const right = b.scheduledMinutesInWindow + (assignedMinutes.get(b.employeeId) ?? 0);
        return mode === "balanced"
          ? left - right || b.score - a.score || a.employeeId - b.employeeId
          : (b.score - a.score) - Math.sign(left - right) * 0.01 ||
              left - right || a.employeeId - b.employeeId;
      });
      let selected = false;
      for (const candidate of available) {
        const proposal: RecoveryProposal = {
          employeeId: candidate.employeeId,
          requirementId: row.requirementId,
          workDate: row.workDate,
          startTime: row.startTime,
          endTime: row.endTime,
          spansMidnight: row.spansMidnight,
        };
        if (recoveryProposalConflict([...chosen, proposal])) {
          avoidedConflictingAssignments++;
          continue;
        }
        const total = candidate.scheduledMinutesInWindow +
          (assignedMinutes.get(candidate.employeeId) ?? 0) + row.paidMinutes;
        chosen.push(proposal);
        assignedMinutes.set(candidate.employeeId,
          (assignedMinutes.get(candidate.employeeId) ?? 0) + row.paidMinutes);
        fills.push({
          requirementId: row.requirementId,
          workDate: row.workDate,
          employeeId: candidate.employeeId,
          employeeName: candidate.employeeName,
          score: candidate.score,
          workloadRisk: candidate.workloadRisk,
          projectedWindowMinutes: total,
          explanation: mode === "balanced"
            ? "Balanced planned hours among eligible colleagues; manager approval required."
            : "Ranked eligible coverage with scarce roles prioritized; manager approval required.",
        });
        selected = true;
        break;
      }
      if (!selected) break;
    }
    avoidedHighRiskCandidates += row.candidates.filter(candidate =>
      candidate.workloadRisk === "high" && !allowHigh).length;
  }
  const countByRequirement = new Map<number, number>();
  for (const fill of fills) countByRequirement.set(fill.requirementId,
    (countByRequirement.get(fill.requirementId) ?? 0) + 1);
  const requirementsRecovered = open.filter(row =>
    (countByRequirement.get(row.requirementId) ?? 0) >= row.gap).length;
  return {
    mode,
    fills,
    baselineGap,
    projectedGap: Math.max(0, baselineGap - fills.length),
    requirementsRecovered,
    requirementsStillAtRisk: open.length - requirementsRecovered,
    avoidedHighRiskCandidates,
    avoidedConflictingAssignments,
    limitedToFiftyClaims: fills.length >= MAX_DRAFT_CLAIMS && baselineGap > fills.length,
  };
}
