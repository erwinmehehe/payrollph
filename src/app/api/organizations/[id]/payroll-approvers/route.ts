import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { userOrganizations, users } from "@/db/schema";
import {
  assertOrganizationRole,
  getAccess,
  PAYROLL_CHECKER_ROLES,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = Number(id);
  if (!/^[1-9]\\d*$/.test(id) || !Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "Invalid organization id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can choose a payroll checker.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  // A unit-scoped operator may nominate checkers only within that same unit.
  // Do not silently treat an invalid scope as company-wide.
  const candidateUnitId = access.companyWide ? null : access.orgUnitId;
  if (!access.companyWide && (
    candidateUnitId === null || !Number.isSafeInteger(candidateUnitId) || candidateUnitId <= 0
  )) {
    return Response.json({ error: "A valid assigned unit is required." }, { status: 403 });
  }

  // Filter before projecting names and emails. Revoked membership, disabled
  // accounts, other roles, other units and this operator are never fetched.
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId,
    })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
      eq(users.active, true),
      inArray(userOrganizations.role, [...PAYROLL_CHECKER_ROLES]),
      ne(userOrganizations.userId, user.id),
      candidateUnitId === null ? undefined : eq(userOrganizations.orgUnitId, candidateUnitId),
    ));

  const approvers = rows
    .filter((row) =>
      row.id !== user.id
      && roleAllowed(row.role, PAYROLL_CHECKER_ROLES)
      && (access.companyWide || row.orgUnitId === access.orgUnitId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ approvers }, { headers: { "Cache-Control": "private, no-store" } });
}
