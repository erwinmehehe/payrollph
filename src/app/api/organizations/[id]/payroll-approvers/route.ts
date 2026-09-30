import { eq } from "drizzle-orm";
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
  if (!Number.isInteger(organizationId)) {
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
    .where(eq(userOrganizations.organizationId, organizationId));

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const approvers = rows
    .filter((row) =>
      row.id !== user.id
      && roleAllowed(row.role, PAYROLL_CHECKER_ROLES)
      && (access.companyWide || row.orgUnitId === access.orgUnitId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({ approvers });
}
