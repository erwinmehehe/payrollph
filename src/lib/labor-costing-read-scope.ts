/**
 * Fail-closed read projection for enterprise labor-costing configuration (#188).
 *
 * Cost-center codes are shared reference choices for unit-scoped employee
 * allocations. GL account codes and legal-entity configuration are a separate
 * company-wide finance surface and are never needed in the unit planner.
 * This is presentation/read authorization; it cannot approve or post payroll.
 */
type EmployerRow = { organizationId: number };

export function scopeLaborCostingRead<
  Center extends EmployerRow,
  Allocation extends EmployerRow & { employeeId: number },
  Entity extends EmployerRow,
  Mapping extends EmployerRow,
>(input: {
  organizationId: number;
  access: { companyWide: boolean; orgUnitId: number | null };
  employeeRows: ReadonlyArray<EmployerRow & { id: number; orgUnitId: number | null }>;
  centerRows: ReadonlyArray<Center>;
  allocationRows: ReadonlyArray<Allocation>;
  entityRows: ReadonlyArray<Entity>;
  glMappingRows: ReadonlyArray<Mapping>;
}) {
  const { organizationId, access } = input;
  const companyWide = access.companyWide === true && access.orgUnitId === null;
  const unitScoped = access.companyWide === false
    && typeof access.orgUnitId === "number"
    && Number.isSafeInteger(access.orgUnitId)
    && access.orgUnitId > 0;
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0
    || (!companyWide && !unitScoped)) return null;

  const visibleEmployeeIds = new Set(input.employeeRows
    .filter((employee) => employee.organizationId === organizationId
      && (companyWide || employee.orgUnitId === access.orgUnitId))
    .map((employee) => employee.id));

  return {
    // All active cost-center choices remain reference data so scoped operators
    // can assign an authorized worker without inventing a new finance center.
    costCenters: input.centerRows.filter((row) => row.organizationId === organizationId),
    allocations: input.allocationRows.filter((row) =>
      row.organizationId === organizationId && visibleEmployeeIds.has(row.employeeId)),
    // Do not ship unrelated legal-entity or GL account configuration in
    // a branch/department payroll response.
    legalEntities: companyWide
      ? input.entityRows.filter((row) => row.organizationId === organizationId) : [],
    glMappings: companyWide
      ? input.glMappingRows.filter((row) => row.organizationId === organizationId) : [],
  };
}
