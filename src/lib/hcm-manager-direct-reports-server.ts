import {
  and, asc, eq, gt, gte, isNull, lte, ne, or, sql,
} from "drizzle-orm";
import { db } from "@/db";
import { employees, positionAssignments, positions, userOrganizations } from "@/db/schema";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import {
  MANAGER_DIRECT_REPORTS_PAGE_SIZE, managerDirectReportsBusinessDate,
  managerDirectReportsEnabledForEmployer, managerDirectReportsUnitId,
  type ManagerDirectReportsPayload,
} from "@/lib/hcm-manager-direct-reports";

export class ManagerDirectReportsAccessError extends Error {
  constructor() { super("Verified manager direct-report access is unavailable."); }
}
export class ManagerDirectReportsQueryError extends Error {
  constructor() { super("Invalid manager direct-report query."); }
}

/**
 * Authorizes the actual user AGAIN at the loader boundary, not only in the
 * GET/page. Resolves their current employer-bound worker identity from the
 * active user_organizations membership (never by name, email or a global account-level employee identifier).
 * Source rows contain no sensitive payroll or HR notes.
 */
export async function loadManagerDirectReports(input: {
  userId: number; organizationId: number; cursor: number;
}): Promise<ManagerDirectReportsPayload> {
  const { userId, organizationId, cursor } = input;
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      !Number.isSafeInteger(organizationId) || organizationId < 1 ||
      !Number.isSafeInteger(cursor) || cursor < 0) {
    throw new ManagerDirectReportsQueryError();
  }
  if (!managerDirectReportsEnabledForEmployer(organizationId)) {
    throw new ManagerDirectReportsAccessError();
  }

  const denied = await assertOrganizationRole(
    userId, organizationId, WORKFORCE_MANAGER_ROLES,
  );
  if (denied) throw new ManagerDirectReportsAccessError();
  const access = await getAccess(userId, organizationId);
  const scopeUnitId = managerDirectReportsUnitId(access);
  if (!scopeUnitId || !access?.orgUnitName) throw new ManagerDirectReportsAccessError();

  // Bind the acting account to an actual employee in this same employer and
  // verified manager unit. A missing, inactive or foreign worker link denies
  // the ENTIRE view rather than widening it to a department roster.
  const [identity] = await db.select({
    managerEmployeeId: userOrganizations.workerEmployeeId,
  }).from(userOrganizations)
    .innerJoin(employees, and(
      eq(employees.id, userOrganizations.workerEmployeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.orgUnitId, scopeUnitId),
    ))
    .where(and(
      eq(userOrganizations.userId, userId),
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.role, "manager"),
      eq(userOrganizations.orgUnitId, scopeUnitId),
      eq(userOrganizations.active, true),
    )).limit(1);
  const managerEmployeeId = identity?.managerEmployeeId;
  if (typeof managerEmployeeId !== "number" ||
      !Number.isSafeInteger(managerEmployeeId) || managerEmployeeId < 1) {
    throw new ManagerDirectReportsAccessError();
  }

  const observedAt = new Date();
  const today = managerDirectReportsBusinessDate(observedAt);

  // The current effective-dated primary assignment is authoritative for the
  // worker-position link. Its position.managerEmployeeId is only a CURRENT
  // manager-of-record pointer, never historical supervision.
  //
  // A correlated tenant-filtered COUNT rejects an employee with multiple
  // current primary assignments, even if only one matches this manager.
  // This check occurs BEFORE the 20+1 cursor cap; do not silently choose one.
  const exactlyOneCurrentPrimary = sql`(
    SELECT count(*) FROM position_assignments AS current_primary
    WHERE current_primary.organization_id = ${organizationId}
      AND current_primary.employee_id = ${employees.id}
      AND current_primary.assignment_type = 'primary'
      AND current_primary.effective_from <= ${today}
      AND (current_primary.effective_until IS NULL OR current_primary.effective_until >= ${today})
  ) = 1`;

  const source = await db.select({
    assignmentId: positionAssignments.id,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    status: employees.status,
    positionCode: positions.code,
    effectiveFrom: positionAssignments.effectiveFrom,
    effectiveUntil: positionAssignments.effectiveUntil,
  }).from(positionAssignments)
    .innerJoin(positions, and(
      eq(positions.id, positionAssignments.positionId),
      eq(positions.organizationId, organizationId),
      eq(positions.managerEmployeeId, managerEmployeeId),
      // A recorded supervisory unit takes precedence over the administrative
      // position unit. Never imply a manager owns child or unrelated units.
      or(
        eq(positions.supervisoryOrgUnitId, scopeUnitId),
        and(isNull(positions.supervisoryOrgUnitId), eq(positions.orgUnitId, scopeUnitId)),
      ),
    ))
    .innerJoin(employees, and(
      eq(employees.id, positionAssignments.employeeId),
      eq(employees.organizationId, organizationId),
      eq(employees.orgUnitId, scopeUnitId),
      ne(employees.id, managerEmployeeId),
    ))
    .where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.assignmentType, "primary"),
      lte(positionAssignments.effectiveFrom, today),
      or(isNull(positionAssignments.effectiveUntil), gte(positionAssignments.effectiveUntil, today)),
      gt(positionAssignments.id, cursor),
      exactlyOneCurrentPrimary,
    ))
    .orderBy(asc(positionAssignments.id))
    .limit(MANAGER_DIRECT_REPORTS_PAGE_SIZE + 1);

  const hasMore = source.length > MANAGER_DIRECT_REPORTS_PAGE_SIZE;
  const page = source.slice(0, MANAGER_DIRECT_REPORTS_PAGE_SIZE);
  return {
    organizationId,
    observedAt: observedAt.toISOString(),
    asOfDate: today,
    scope: { kind: "verified_direct_reports", orgUnitId: scopeUnitId },
    items: page.map((row) => ({
      assignmentId: row.assignmentId,
      employeeNo: row.employeeNo,
      name: [row.firstName, row.lastName].filter(Boolean).join(" "),
      status: row.status,
      positionCode: row.positionCode,
      reportingUnitId: scopeUnitId,
      reportingUnitName: access.orgUnitName!,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
    })),
    page: {
      size: 20,
      hasMore,
      nextCursor: hasMore ? page[page.length - 1]?.assignmentId ?? null : null,
    },
    warning: "Current source snapshot, not historical supervision or certified headcount. Only direct reports with one unambiguous current primary assignment and matching employer/unit/manager-of-record are shown. Missing or conflicting relationships are omitted, never guessed. No payroll or approval authority is provided.",
  };
}
