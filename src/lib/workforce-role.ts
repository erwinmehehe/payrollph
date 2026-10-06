export type EffectivePositionAssignment = {
  id: number;
  employeeId: number;
  positionId: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
};

export type PositionRole = {
  id: number;
  jobProfileId: number;
};

export function effectiveJobProfileId(input: {
  employeeId: number;
  date: string;
  assignments: EffectivePositionAssignment[];
  positions: PositionRole[];
}) {
  const assignment = input.assignments
    .filter((row) =>
      row.employeeId === input.employeeId
      && row.effectiveFrom <= input.date
      && (!row.effectiveUntil || row.effectiveUntil >= input.date),
    )
    .sort((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom)
      || b.id - a.id,
    )[0];

  if (!assignment) return null;
  return input.positions.find((position) => position.id === assignment.positionId)?.jobProfileId ?? null;
}
