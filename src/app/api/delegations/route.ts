import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalDelegations, userOrganizations, users } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { resolveEffectiveApprovers } from "@/lib/delegation";
import { uniqueDelegationMember } from "@/lib/delegation-members";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  APPROVAL_ADMIN_ROLES,
  assertOrganizationRole,
  getAccess,
  PAYROLL_CHECKER_ROLES,
  roleAllowed,
} from "@/lib/access";

export const dynamic = "force-dynamic";

const delegationNotFound = () =>
  Response.json({ error: "Delegation not found." }, { status: 404 });

// Look up participants only through ACTIVE membership in the selected tenant.
// Display names are not unique account identifiers.
async function activeDelegationMembers(organizationId: number) {
  return db.select({
    id: users.id, name: users.name, role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
  }).from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
    ));
}


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

  const access = await getAccess(user.id, organizationId);
  const canAdminister = Boolean(access?.companyWide && roleAllowed(access.role, APPROVAL_ADMIN_ROLES));
  if (!canAdminister) {
    // Non-admin visibility relies on names. A duplicate name is not a safe grant.
    const actor = uniqueDelegationMember(await activeDelegationMembers(organizationId), user.name);
    if (actor?.id !== user.id) {
      return Response.json({ error: "Approval delegation identity is ambiguous." }, { status: 403 });
    }
  }

  const probe = new URL(request.url).searchParams.get("approver");
  const rows = await db.select().from(approvalDelegations)
    .where(eq(approvalDelegations.organizationId, organizationId))
    .orderBy(desc(approvalDelegations.id));
  const visibleRows = canAdminister
    ? rows
    : rows.filter(
        (row) =>
          row.fromApprover.toLowerCase() === user.name.toLowerCase() ||
          row.toApprover.toLowerCase() === user.name.toLowerCase(),
      );
  const resolved = probe && (canAdminister || probe.toLowerCase() === user.name.toLowerCase())
    ? await resolveEffectiveApprovers(organizationId, probe)
    : null;

  return Response.json({ delegations: visibleRows, resolved });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Approval delegation changes");
  if (demoDenied) return demoDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

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
  const canAdminister = Boolean(access?.companyWide && roleAllowed(access.role, APPROVAL_ADMIN_ROLES));
  if (!canAdminister && fromApprover.toLowerCase() !== user.name.toLowerCase()) {
    return Response.json({ error: "You can delegate only approvals assigned to your own account." }, { status: 403 });
  }

  const members = await activeDelegationMembers(organizationId);
  const visibleMembers = access?.companyWide
    ? members
    : members.filter((member) => member.orgUnitId === access?.orgUnitId);
  const fromUser = uniqueDelegationMember(visibleMembers, fromApprover);
  const toUser = uniqueDelegationMember(visibleMembers, toApprover);
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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Approval delegation changes");
  if (demoDenied) return demoDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  // Never let a foreign-but-existing ID be distinguished from a missing ID.
  // Join the target's own tenant to the actor's ACTIVE membership first.
  const [visibleTarget] = await db.select({ delegation: approvalDelegations })
    .from(approvalDelegations)
    .innerJoin(userOrganizations, and(
      eq(userOrganizations.organizationId, approvalDelegations.organizationId),
      eq(userOrganizations.userId, user.id),
      eq(userOrganizations.active, true),
    ))
    .where(eq(approvalDelegations.id, id)).limit(1);
  const target = visibleTarget?.delegation;
  if (!target) return delegationNotFound();

  const denied = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PAYROLL_CHECKER_ROLES,
    "Only approval participants can change delegations.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, target.organizationId);
  const canAdminister = Boolean(access?.companyWide && roleAllowed(access.role, APPROVAL_ADMIN_ROLES));
  if (typeof body.active !== "boolean") {
    return Response.json({ error: "active must be true or false." }, { status: 400 });
  }
  // Non-admin mutations require an unambiguous currently active source
  // identity. Re-enabling also requires the two participants to remain
  // active, approval-capable and visible within the actor's present scope.
  if (!canAdminister || body.active) {
    const members = await activeDelegationMembers(target.organizationId);
    const visibleMembers = access?.companyWide
      ? members
      : members.filter((member) => member.orgUnitId === access?.orgUnitId);
    const fromUser = uniqueDelegationMember(visibleMembers, target.fromApprover);
    if (!canAdminister && fromUser?.id !== user.id) {
      return Response.json({ error: "You can change only your own active approval identity." }, { status: 403 });
    }
    if (body.active) {
      const toUser = uniqueDelegationMember(visibleMembers, target.toApprover);
      if (!fromUser || !toUser
          || !roleAllowed(fromUser.role, PAYROLL_CHECKER_ROLES)
          || !roleAllowed(toUser.role, PAYROLL_CHECKER_ROLES)) {
        return Response.json({ error: "Delegation participants require active approval-capable memberships." }, { status: 409 });
      }
    }
  }

  const [row] = await db.update(approvalDelegations)
    .set({ active: body.active })
    .where(and(eq(approvalDelegations.id, id), eq(approvalDelegations.organizationId, target.organizationId)))
    .returning();
  if (!row) return delegationNotFound();

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: user.name,
    action: row.active ? "Approval delegation enabled" : "Approval delegation revoked",
    resource: `${row.fromApprover} → ${row.toApprover}`,
    metadata: { delegationId: row.id },
  });

  return Response.json(row);
}
