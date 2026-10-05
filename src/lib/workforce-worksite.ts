const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WorksiteAssignmentRecord = {
  id: number;
  worksiteId: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
};

export function selectEffectiveWorksiteAssignment(
  assignments: WorksiteAssignmentRecord[],
  date: string,
) {
  if (!ISO_DATE.test(date)) throw new Error("Worksite date must use YYYY-MM-DD.");

  return assignments
    .filter((assignment) =>
      assignment.effectiveFrom <= date
      && (!assignment.effectiveUntil || assignment.effectiveUntil >= date),
    )
    .sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id - a.id,
    )[0] ?? null;
}

function rangeEnd(value: string | null | undefined) {
  return value || "9999-12-31";
}

export function worksiteAssignmentOverlaps(
  existing: WorksiteAssignmentRecord[],
  candidate: {
    effectiveFrom: string;
    effectiveUntil?: string | null;
  },
) {
  if (!ISO_DATE.test(candidate.effectiveFrom)) {
    throw new Error("Worksite assignment effectiveFrom must use YYYY-MM-DD.");
  }
  if (candidate.effectiveUntil && !ISO_DATE.test(candidate.effectiveUntil)) {
    throw new Error("Worksite assignment effectiveUntil must use YYYY-MM-DD.");
  }
  if (candidate.effectiveUntil && candidate.effectiveUntil < candidate.effectiveFrom) {
    throw new Error("Worksite assignment end date cannot be before its start date.");
  }

  const candidateEnd = rangeEnd(candidate.effectiveUntil);
  return existing.some((assignment) => {
    const existingEnd = rangeEnd(assignment.effectiveUntil);
    return assignment.effectiveFrom <= candidateEnd
      && candidate.effectiveFrom <= existingEnd;
  });
}

export function resolveWorksiteId(input: {
  date: string;
  scheduleWorksiteId?: number | null;
  assignments?: WorksiteAssignmentRecord[];
}) {
  if (input.scheduleWorksiteId != null) return input.scheduleWorksiteId;
  return selectEffectiveWorksiteAssignment(
    input.assignments ?? [],
    input.date,
  )?.worksiteId ?? null;
}
