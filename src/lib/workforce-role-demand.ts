export type RolePosition = {
  id: number;
  jobProfileId: number;
};

export type RoleAssignment = {
  employeeId: number;
  positionId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type EmployeeRoleResolution = {
  jobProfileId: number | null;
  ambiguous: boolean;
  positionIds: number[];
};

export function resolveEmployeeJobProfileAtDate(input: {
  employeeId: number;
  date: string;
  assignments: RoleAssignment[];
  positions: RolePosition[];
}): EmployeeRoleResolution {
  const positionById = new Map(input.positions.map((position) => [position.id, position]));
  const active = input.assignments
    .filter((assignment) =>
      assignment.employeeId === input.employeeId
      && assignment.effectiveFrom <= input.date
      && (!assignment.effectiveUntil || input.date <= assignment.effectiveUntil),
    )
    .map((assignment) => ({
      assignment,
      position: positionById.get(assignment.positionId) ?? null,
    }))
    .filter((row): row is { assignment: RoleAssignment; position: RolePosition } => Boolean(row.position));

  const roleIds = [...new Set(active.map((row) => row.position.jobProfileId))];
  return {
    jobProfileId: roleIds.length === 1 ? roleIds[0] : null,
    ambiguous: roleIds.length > 1,
    positionIds: active.map((row) => row.position.id).sort((a, b) => a - b),
  };
}

export function roleRequirementMatches(
  requiredJobProfileId: number | null,
  employeeJobProfileId: number | null,
) {
  return requiredJobProfileId == null || requiredJobProfileId === employeeJobProfileId;
}


export function assertUnambiguousRoleDemand(rows: Array<{
  worksiteId: number;
  workDate: string;
  shiftDefinitionId: number;
  jobProfileId?: number | null;
}>) {
  const groups = new Map<string, Set<number | null>>();
  for (const row of rows) {
    const key = `${row.worksiteId}|${row.workDate}|${row.shiftDefinitionId}`;
    const roles = groups.get(key) ?? new Set<number | null>();
    roles.add(row.jobProfileId ?? null);
    groups.set(key, roles);
  }
  for (const [key, roles] of groups) {
    if (roles.has(null) && [...roles].some((role) => role != null)) {
      throw new Error(
        `Ambiguous staffing demand for ${key}: generic and role-specific requirements cannot coexist.`,
      );
    }
  }
}
