import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveEffectiveApprovers } from "@/lib/delegation";
import {
  APPROVAL_ADMIN_ROLES,
  assertOrganizationRole,
  getAccess,
  PAYROLL_CHECKER_ROLES,
  roleAllowed,
} from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_CHECKER_ROLES,
    "Only approval participants can view approval delegations.",
  );
  if (denied) return denied;

  const probe = new URL(request.url).searchParams.get("approver");
  const rows = await db.select().from(approvalDelegations)
    .where(eq(approvalDelegations.organizationId, organizationId))
    .orderBy(desc(approvalDelegations.id));

  const access = await getAccess(user.id, organizationId);
  const visibleRows =
    access && roleAllowed(access.role, APPROVAL_ADMIN_ROLES)
      ? rows
      : rows.filter(
          (row) =>
            row.fromApprover.toLowerCase() === user.name.toLowerCase() ||
            row.toApprover.toLowerCase() === user.name.toLowerCase(),
        );

  const resolved =
    probe && (access && roleAllowed(access.role, APPROVAL_ADMIN_ROLES) || probe.toLowerCase() === user.name.toLowerCase())
      ? await resolveEffectiveApprovers(organizationId, probe)
      : null;

  return Response.json({ delegations: visibleRows, resolved });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const fromApprover = String(body.fromApprover ?? "").trim();
  const toApprover = String(body.toApprover ?? "").trim();
  const startsOn = String(body.startsOn ?? "").trim();
  const endsOn = String(body.endsOn ?? "").trim();

  if (!Number.isInteger(organizationId) || !fromApprover || !toApprover || !startsOn || !endsOn) {
    return Response.json({ error: "organizationId, fromApprover, toApprover, startsOn and endsOn are required." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn) {
    return Response.json({ error: "Delegation needs a valid start/end date and cannot end before it starts." }, { status: 422 });
  }
  if (fromApprover.toLowerCase() === toApprover.toLowerCase()) {
    return Response.json({ error: "An approver cannot delegate to themselves." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_CHECKER_ROLES,
    "Only approval participants can create delegations.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  const canAdminister = Boolean(access && roleAllowed(access.role, APPROVAL_ADMIN_ROLES));
  if (!canAdminister && fromApprover.toLowerCase() !== user.name.toLowerCase()) {
    return Response.json({ error: "You can delegate only approvals assigned to your own account." }, { status: 403 });
  }

  const members = await db
    .select({ id: users.id, name: users.name, role: userOrganizations.role })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, organizationId));

  const fromUser = members.find((member) => member.name.toLowerCase() === fromApprover.toLowerCase());
  const toUser = members.find((member) => member.name.toLowerCase() === toApprover.toLowerCase());
  if (!fromUser || !toUser) {
    return Response.json({ error: "Both the source approver and delegate must be authenticated members of this workspace." }, { status: 422 });
  }
  if (!roleAllowed(fromUser.role, PAYROLL_CHECKER_ROLES) || !roleAllowed(toUser.role, PAYROLL_CHECKER_ROLES)) {
    return Response.json({ error: "Both accounts must have an approval-capable workspace role." }, { status: 422 });
  }

  const [row] = await db.insert(approvalDelegations).values({
    organizationId,
    fromApprover: fromUser.name,
    toApprover: toUser.name,
    reason: String(body.reason ?? "Out of office").slice(0, 200),
    startsOn,
    endsOn,
    active: true,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Approval delegation created",
    resource: `${fromUser.name} → ${toUser.name}`,
    metadata: { delegationId: row.id, startsOn, endsOn, fromUserId: fromUser.id, toUserId: toUser.id, reason: row.reason },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [target] = await db.select().from(approvalDelegations).where(eq(approvalDelegations.id, id)).limit(1);
  if (!target) return Response.json({ error: "Delegation not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PAYROLL_CHECKER_ROLES,
    "Only approval participants can change delegations.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, target.organizationId);
  const canAdminister = Boolean(access && roleAllowed(access.role, APPROVAL_ADMIN_ROLES));
  if (!canAdminister && target.fromApprover.toLowerCase() !== user.name.toLowerCase()) {
    return Response.json({ error: "You can change only delegations created from your own approval identity." }, { status: 403 });
  }

  const [row] = await db.update(approvalDelegations)
    .set({ active: Boolean(body.active) })
    .where(and(eq(approvalDelegations.id, id), eq(approvalDelegations.organizationId, target.organizationId)))
    .returning();

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: user.name,
    action: row.active ? "Approval delegation enabled" : "Approval delegation revoked",
    resource: `${row.fromApprover} → ${row.toApprover}`,
    metadata: { delegationId: row.id },
  });

  return Response.json(row);
}
