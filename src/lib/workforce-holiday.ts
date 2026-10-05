export type WorkforceHolidayScopeRow = {
  orgUnitId: number | null;
  worksiteId: number | null;
};

export function workforceHolidayApplies(input: {
  holiday: WorkforceHolidayScopeRow;
  employeeOrgUnitScopeIds: ReadonlySet<number>;
  resolvedWorksiteId: number | null;
}) {
  const orgUnitMatches =
    input.holiday.orgUnitId == null
    || input.employeeOrgUnitScopeIds.has(input.holiday.orgUnitId);
  if (!orgUnitMatches) return false;

  return input.holiday.worksiteId == null
    || input.holiday.worksiteId === input.resolvedWorksiteId;
}
