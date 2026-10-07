import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayoutChangeRequests,
  treasuryControlPolicies,
  treasuryOperatorAssignments,
  userOrganizations,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  getAccess,
  ORG_ADMIN_ROLES,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  TREASURY_OPERATOR_ELIGIBLE_ROLES,
  treasuryControlPolicy,
  treasuryOperatorAssigned,
} from "@/lib/treasury-controls";

export const dynamic = "force-dynamic";
const TREASURY_POLICY_ADMIN_ROLES = ["owner"] as const;
const RELEASE_CAPABLE_ROLES = new Set(["owner", "admin"]);

async function companyWideCandidates(organizationId: number) {
  const rows = await db.select({
    membershipId: userOrganizations.id,
    userId: users.id,
    name: users.name,
    email: users.email,
    role: userOrganizations.role,
    active: userOrganizations.active,
    userActive: users.active,
  }).from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(and(
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
      eq(users.active, true),
      isNull(userOrganizations.orgUnitId),
    ));

  return rows.filter((row) => roleAllowed(row.role, TREASURY_OPERATOR_ELIGIBLE_ROLES));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const view = new URL(request.url).searchParams.get("view");
  if (view === "current-user") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can view their treasury authorization status.",
    );
    if (denied) return denied;
    const policy = await treasuryControlPolicy(organizationId);
    return Response.json({
      policy: {
        enabled: policy?.enabled ?? false,
        requireReleaseSubmitterSeparation: policy?.requireReleaseSubmitterSeparation ?? true,
        enabledAt: policy?.enabledAt?.toISOString() ?? null,
      },
      currentUserAssigned: await treasuryOperatorAssigned(organizationId, user.id),
      canConfigure: false,
    });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company administrators can view treasury controls.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Treasury controls require company-wide access." }, { status: 403 });
  }

  const [policy, candidates, assignments] = await Promise.all([
    treasuryControlPolicy(organizationId),
    companyWideCandidates(organizationId),
    db.select().from(treasuryOperatorAssignments).where(and(
      eq(treasuryOperatorAssignments.organizationId, organizationId),
      eq(treasuryOperatorAssignments.active, true),
    )),
  ]);

  return Response.json({
    policy: {
      enabled: policy?.enabled ?? false,
      requireReleaseSubmitterSeparation: policy?.requireReleaseSubmitterSeparation ?? true,
      enabledAt: policy?.enabledAt?.toISOString() ?? null,
    },
    candidates,
    operatorUserIds: assignments.map((row) => row.userId),
    currentUserAssigned: await treasuryOperatorAssigned(organizationId, user.id),
    canConfigure: access.role === "owner",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Treasury controls");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    TREASURY_POLICY_ADMIN_ROLES,
    "Only the workspace owner can configure treasury separation.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Treasury controls require company-wide access." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "treasury-control-policy",
    resourceId: organizationId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (String(body.action ?? "") !== "save-policy") {
    return Response.json({ error: "Unsupported treasury-control action." }, { status: 400 });
  }

  const enabled = Boolean(body.enabled);
  const requireSeparation = body.requireReleaseSubmitterSeparation !== false;
  const requestedIds: number[] = [];
  if (Array.isArray(body.operatorUserIds)) {
    for (const value of body.operatorUserIds as unknown[]) {
      const userId = Number(value);
      if (Number.isInteger(userId) && !requestedIds.includes(userId)) {
        requestedIds.push(userId);
      }
    }
  }

  const candidates = await companyWideCandidates(organizationId);
  const candidateIds = new Set(candidates.map((row) => row.userId));
  if (requestedIds.some((id) => !candidateIds.has(id))) {
    return Response.json({
      error: "Every treasury operator must be an active, company-wide owner, administrator, or bookkeeper.",
    }, { status: 400 });
  }

  if (enabled && requestedIds.length === 0) {
    return Response.json({ error: "Assign at least one treasury operator before enabling separation." }, { status: 400 });
  }

  if (enabled && requireSeparation) {
    const viable = candidates.some((releaseUser) =>
      RELEASE_CAPABLE_ROLES.has(releaseUser.role)
      && requestedIds.some((treasuryUserId) => treasuryUserId !== releaseUser.userId)
    );
    if (!viable) {
      return Response.json({
        error: "Treasury separation needs two distinct company-wide users: one release-capable owner/admin and a different assigned treasury operator.",
      }, { status: 409 });
    }
  }

  if (!enabled) {
    const [pendingPayoutChange] = await db.select({ id: employeePayoutChangeRequests.id })
      .from(employeePayoutChangeRequests)
      .where(and(
        eq(employeePayoutChangeRequests.organizationId, organizationId),
        eq(employeePayoutChangeRequests.status, "pending"),
      ))
      .limit(1);
    if (pendingPayoutChange) {
      return Response.json({
        error: "Resolve pending payout destination change requests before disabling treasury separation.",
        payoutDestinationChangeRequestId: pendingPayoutChange.id,
      }, { status: 409 });
    }
  }

  const existing = await treasuryControlPolicy(organizationId);
  const now = new Date();
  const enabledAt = enabled
    ? existing?.enabled
      ? existing.enabledAt ?? now
      : now
    : null;

  await db.transaction(async (tx) => {
    await tx.insert(treasuryControlPolicies).values({
      organizationId,
      enabled,
      requireReleaseSubmitterSeparation: requireSeparation,
      enabledAt,
      createdByUserId: existing?.createdByUserId ?? user.id,
      updatedByUserId: user.id,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: treasuryControlPolicies.organizationId,
      set: {
        enabled,
        requireReleaseSubmitterSeparation: requireSeparation,
        enabledAt,
        updatedByUserId: user.id,
        updatedAt: now,
      },
    });

    await tx.update(treasuryOperatorAssignments).set({
      active: false,
      updatedAt: now,
    }).where(eq(treasuryOperatorAssignments.organizationId, organizationId));

    for (const userId of requestedIds) {
      await tx.insert(treasuryOperatorAssignments).values({
        organizationId,
        userId,
        active: true,
        createdByUserId: user.id,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [
          treasuryOperatorAssignments.organizationId,
          treasuryOperatorAssignments.userId,
        ],
        set: { active: true, updatedAt: now },
      });
    }
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: enabled ? "Treasury separation policy enabled or updated" : "Treasury separation policy disabled",
    resource: "Payroll treasury controls",
    metadata: {
      enabled,
      requireReleaseSubmitterSeparation: requireSeparation,
      operatorUserIds: requestedIds,
      enabledAt: enabledAt?.toISOString() ?? null,
      configuredByUserId: user.id,
    },
  });

  return Response.json({
    enabled,
    requireReleaseSubmitterSeparation: requireSeparation,
    operatorUserIds: requestedIds,
    enabledAt: enabledAt?.toISOString() ?? null,
  });
}
