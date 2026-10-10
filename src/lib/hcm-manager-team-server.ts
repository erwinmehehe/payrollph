import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, positionAssignments, positions, userOrganizations } from "@/db/schema";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import {
  MANAGER_TEAM_PAGE_SIZE,
  managerTeamBusinessDate,
  projectManagerTeamPage,
  type ManagerTeamPage,
} from "@/lib/hcm-manager-team";

/**
 * Strong manager identity, NOT a configurable query filter. The authenticated
 * user's tenant-linked worker mapping must exist and refer to a real employee
 * in the same employer. Role and deny-only workforce permission are required.
 */
export type ManagerTeamAccess = {
  organizationId: number;
  managerEmployeeId: number;
  orgUnitId: number | null;
};

export async function authorizeManagerTeam(
  userId: number,
  organizationId: number,
): Promise<ManagerTeamAccess | null> {
  const denied = await assertOrganizationRole(
    userId, organizationId, WORKFORCE_MANAGER_ROLES,
    "Only an authorized manager may view current direct reports.",
  );
  if (denied) return null;

  const access = await getAccess(userId, organizationId);
  // In P5 there is no HR/company-wide impersonation of arbitrary managers.
  if (!access || access.role !== "manager") return null;

  const [membership] = await db.select({
    workerEmployeeId: userOrganizations.workerEmployeeId,
  }).from(userOrganizations).where(and(
    eq(userOrganizations.userId, userId),
    eq(userOrganizations.organizationId, organizationId),
    eq(userOrganizations.role, "manager"),
    eq(userOrganizations.active, true),
  )).limit(1);
  if (!membership?.workerEmployeeId) return null;

  const [manager] = await db.select({
    id: employees.id,
    status: employees.status,
    orgUnitId: employees.orgUnitId,
  }).from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.id, membership.workerEmployeeId),
  )).limit(1);
  if (!manager || !["Active", "On leave"].includes(manager.status)) return null;
  if (!access.companyWide &&
      (access.orgUnitId == null || access.orgUnitId !== manager.orgUnitId)) return null;

  return {
    organizationId,
    managerEmployeeId: manager.id,
    orgUnitId: access.companyWide ? null : access.orgUnitId,
  };
}

/**
 * Read-only SQL source. All three authoritative worker/position/assignment
 * joins are explicitly tenant-bound, not simply FK-bound. Unit-scoped managers
 * see only direct reports within the same worker, position and supervision
 * scope. A second live primary assignment makes that worker ineligible;
 * ambiguity never turns into an inferred reporting relationship.
 *
 * The position manager link is mutable, so this is TODAY'S recorded team, not
 * a historical org chart. Cursor is the assignment ID, never a data offset.
 */
export async function loadManagerTeamPage(
  scope: ManagerTeamAccess,
  cursor: number | null,
  now = new Date(),
): Promise<ManagerTeamPage> {
  const businessDate = managerTeamBusinessDate(now);
  const filters = [
    eq(positionAssignments.organizationId, scope.organizationId),
    eq(positions.organizationId, scope.organizationId),
    eq(employees.organizationId, scope.organizationId),
    eq(positionAssignments.assignmentType, "primary"),
    eq(positions.managerEmployeeId, scope.managerEmployeeId),
    ne(employees.id, scope.managerEmployeeId),
    inArray(employees.status, ["Active", "On leave", "Separating"]),
    lte(positionAssignments.effectiveFrom, businessDate),
    or(isNull(positionAssignments.effectiveUntil), gte(positionAssignments.effectiveUntil, businessDate)),
    // Correlated source-integrity test: hide duplicate primary incumbencies.
    // It is not safe to select whichever conflicting position sorts first.
    sql`not exists (
      select 1 from position_assignments other_assignment
      where other_assignment.organization_id = ${scope.organizationId}
        and other_assignment.employee_id = ${positionAssignments.employeeId}
        and other_assignment.assignment_type = 'primary'
        and other_assignment.id <> ${positionAssignments.id}
        and other_assignment.effective_from <= ${businessDate}
        and (other_assignment.effective_until is null or other_assignment.effective_until >= ${businessDate})
    )`,
  ];
  if (scope.orgUnitId !== null) {
    filters.push(
      eq(employees.orgUnitId, scope.orgUnitId),
      eq(positions.orgUnitId, scope.orgUnitId),
      or(isNull(positions.supervisoryOrgUnitId),
        eq(positions.supervisoryOrgUnitId, scope.orgUnitId))!,
    );
  }
  if (cursor !== null) filters.push(lt(positionAssignments.id, cursor));

  const records = await db.select({
    assignmentId: positionAssignments.id,
    employeeId: employees.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    employeeStatus: employees.status,
    positionCode: positions.code,
    positionStatus: positions.status,
    unitName: orgUnits.name,
    assignmentFrom: positionAssignments.effectiveFrom,
    assignmentUntil: positionAssignments.effectiveUntil,
  }).from(positionAssignments)
    .innerJoin(positions, and(
      eq(positions.id, positionAssignments.positionId),
      eq(positions.organizationId, scope.organizationId),
    ))
    .innerJoin(employees, and(
      eq(employees.id, positionAssignments.employeeId),
      eq(employees.organizationId, scope.organizationId),
    ))
    .leftJoin(orgUnits, and(
      eq(orgUnits.id, positions.orgUnitId),
      eq(orgUnits.organizationId, scope.organizationId),
    ))
    .where(and(...filters))
    .orderBy(desc(positionAssignments.id))
    .limit(MANAGER_TEAM_PAGE_SIZE + 1);

  return projectManagerTeamPage(records.map((row) => ({
    ...row,
    assignmentFrom: String(row.assignmentFrom),
    assignmentUntil: row.assignmentUntil == null ? null : String(row.assignmentUntil),
  })), {
    organizationId: scope.organizationId,
    managerEmployeeId: scope.managerEmployeeId,
    businessDate,
  });
}
