import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizationSecurityPolicies,
  permissionSets,
  scimTokens,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "@/db/schema";
import { assertOrganizationRole } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { organizationLocalMfaReadiness, organizationSecurityPolicy } from "@/lib/enterprise-session";
import { ROLE_GATE_PERMISSIONS, roleGateAllowed } from "@/lib/permissions";
import { mintScimToken } from "@/lib/scim";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
const OWNER_ONLY = ["owner"] as const;

async function ownerGate(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    OWNER_ONLY,
    "Only the workspace owner can manage enterprise access controls.",
  );
  if (denied) return denied;
  const overlay = await roleGateAllowed(userId, organizationId, "org.admin");
  if (!overlay.allowed) {
    return Response.json({ error: "Your custom permission set does not allow organization administration." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await ownerGate(user.id, organizationId);
  if (denied) return denied;

  const [policy, readiness, tokens, sets, memberships, assignments] = await Promise.all([
    organizationSecurityPolicy(organizationId),
    organizationLocalMfaReadiness(organizationId),
    db.select({
      id: scimTokens.id,
      name: scimTokens.name,
      prefix: scimTokens.prefix,
      lastUsedAt: scimTokens.lastUsedAt,
      revokedAt: scimTokens.revokedAt,
      createdAt: scimTokens.createdAt,
    }).from(scimTokens).where(eq(scimTokens.organizationId, organizationId)).orderBy(asc(scimTokens.id)),
    db.select().from(permissionSets).where(eq(permissionSets.organizationId, organizationId)).orderBy(asc(permissionSets.name)),
    db.select({
      id: userOrganizations.id,
      userId: userOrganizations.userId,
      role: userOrganizations.role,
      active: userOrganizations.active,
      email: users.email,
      name: users.name,
    }).from(userOrganizations)
      .innerJoin(users, eq(users.id, userOrganizations.userId))
      .where(eq(userOrganizations.organizationId, organizationId))
      .orderBy(asc(userOrganizations.id)),
    db.select().from(userPermissionAssignments)
      .where(eq(userPermissionAssignments.organizationId, organizationId)),
  ]);

  return Response.json({
    policy: policy ?? {
      sessionIdleMinutes: 1440,
      sessionMaxHours: 336,
      maxActiveSessions: 10,
      requireLocalMfa: false,
    },
    localMfaReadiness: readiness,
    scimTokens: tokens,
    permissionSets: sets,
    memberships,
    assignments,
    availablePermissions: ROLE_GATE_PERMISSIONS,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await ownerGate(user.id, organizationId);
  if (denied) return denied;

  if (action === "save_policy") {
    const sessionIdleMinutes = Math.round(Number(body.sessionIdleMinutes));
    const sessionMaxHours = Math.round(Number(body.sessionMaxHours));
    const maxActiveSessions = Math.round(Number(body.maxActiveSessions));
    const requireLocalMfa = body.requireLocalMfa === true;
    if (
      !Number.isFinite(sessionIdleMinutes) || sessionIdleMinutes < 15 || sessionIdleMinutes > 10080 ||
      !Number.isFinite(sessionMaxHours) || sessionMaxHours < 1 || sessionMaxHours > 720 ||
      !Number.isFinite(maxActiveSessions) || maxActiveSessions < 1 || maxActiveSessions > 20
    ) {
      return Response.json({ error: "Session policy values are outside supported limits." }, { status: 400 });
    }
    if (requireLocalMfa) {
      const readiness = await organizationLocalMfaReadiness(organizationId);
      if (readiness.notReadyUserIds.length > 0) {
        return Response.json({
          error: `${readiness.notReadyUserIds.length} active local-password user(s) must enroll TOTP before organization-wide local MFA can be required.`,
          notReadyUserIds: readiness.notReadyUserIds,
        }, { status: 409 });
      }
    }
    const [row] = await db.insert(organizationSecurityPolicies).values({
      organizationId,
      sessionIdleMinutes,
      sessionMaxHours,
      maxActiveSessions,
      requireLocalMfa,
      updatedByUserId: user.id,
    }).onConflictDoUpdate({
      target: organizationSecurityPolicies.organizationId,
      set: {
        sessionIdleMinutes,
        sessionMaxHours,
        maxActiveSessions,
        requireLocalMfa,
        updatedByUserId: user.id,
        updatedAt: new Date(),
      },
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Enterprise session policy updated",
      resource: "Organization security policy",
      metadata: { sessionIdleMinutes, sessionMaxHours, maxActiveSessions, requireLocalMfa },
    });
    return Response.json(row);
  }

  if (action === "mint_scim_token") {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) return Response.json({ error: "SCIM token name is required." }, { status: 400 });
    const minted = mintScimToken();
    const [row] = await db.insert(scimTokens).values({
      organizationId,
      name: name.slice(0, 120),
      prefix: minted.prefix,
      tokenHash: minted.tokenHash,
      createdByUserId: user.id,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "SCIM token created",
      resource: row.name,
      metadata: { scimTokenId: row.id, prefix: row.prefix },
    });
    return Response.json({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      token: minted.token,
      warning: "This SCIM bearer token is shown once and stored only as a SHA-256 hash.",
    }, { status: 201 });
  }

  if (action === "revoke_scim_token") {
    const tokenId = Number(body.tokenId);
    const [row] = await db.update(scimTokens).set({ revokedAt: new Date() }).where(and(
      eq(scimTokens.id, tokenId),
      eq(scimTokens.organizationId, organizationId),
    )).returning();
    if (!row) return Response.json({ error: "SCIM token not found." }, { status: 404 });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "SCIM token revoked",
      resource: row.name,
      metadata: { scimTokenId: row.id, prefix: row.prefix },
    });
    return Response.json({ ok: true });
  }

  if (action === "save_permission_set") {
    const id = body.id == null ? null : Number(body.id);
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const requested = Array.isArray(body.permissions)
      ? body.permissions.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const permissions = [...new Set(requested.filter((value: string) =>
      (ROLE_GATE_PERMISSIONS as readonly string[]).includes(value)))];
    if (name.length < 2 || permissions.length === 0) {
      return Response.json({ error: "Permission-set name and at least one valid permission are required." }, { status: 400 });
    }

    if (id) {
      const [row] = await db.update(permissionSets).set({
        name: name.slice(0, 120),
        description: description.slice(0, 4000) || null,
        permissions,
        active: body.active !== false,
        updatedAt: new Date(),
      }).where(and(eq(permissionSets.id, id), eq(permissionSets.organizationId, organizationId))).returning();
      if (!row) return Response.json({ error: "Permission set not found." }, { status: 404 });
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Permission set updated",
        resource: row.name,
        metadata: { permissionSetId: row.id, permissions },
      });
      return Response.json(row);
    }

    try {
      const [row] = await db.insert(permissionSets).values({
        organizationId,
        name: name.slice(0, 120),
        description: description.slice(0, 4000) || null,
        permissions,
        active: true,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Permission set created",
        resource: row.name,
        metadata: { permissionSetId: row.id, permissions },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A permission set with this name already exists." }, { status: 409 });
    }
  }

  if (action === "assign_permission_set") {
    const membershipId = Number(body.membershipId);
    const permissionSetId = body.permissionSetId == null ? null : Number(body.permissionSetId);
    const [membership] = await db.select().from(userOrganizations).where(and(
      eq(userOrganizations.id, membershipId),
      eq(userOrganizations.organizationId, organizationId),
      eq(userOrganizations.active, true),
    )).limit(1);
    if (!membership) return Response.json({ error: "Active workspace membership not found." }, { status: 404 });

    if (permissionSetId == null) {
      await db.delete(userPermissionAssignments).where(and(
        eq(userPermissionAssignments.organizationId, organizationId),
        eq(userPermissionAssignments.userOrganizationId, membershipId),
      ));
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Permission set cleared",
        resource: "Membership #" + membershipId,
        metadata: { membershipId },
      });
      return Response.json({ ok: true, permissionSetId: null });
    }

    const [permissionSet] = await db.select().from(permissionSets).where(and(
      eq(permissionSets.id, permissionSetId),
      eq(permissionSets.organizationId, organizationId),
      eq(permissionSets.active, true),
    )).limit(1);
    if (!permissionSet) return Response.json({ error: "Active permission set not found." }, { status: 404 });

    const values = Array.isArray(permissionSet.permissions)
      ? permissionSet.permissions.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (membership.userId === user.id && !values.includes("org.admin")) {
      return Response.json({
        error: "You cannot restrict your own membership so that organization administration is removed.",
      }, { status: 409 });
    }

    const [row] = await db.insert(userPermissionAssignments).values({
      organizationId,
      userOrganizationId: membershipId,
      permissionSetId,
      assignedByUserId: user.id,
    }).onConflictDoUpdate({
      target: userPermissionAssignments.userOrganizationId,
      set: { permissionSetId, assignedByUserId: user.id },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Permission set assigned",
      resource: "Membership #" + membershipId,
      metadata: { membershipId, permissionSetId, baseRole: membership.role },
    });
    return Response.json(row);
  }

  return Response.json({ error: "Unknown enterprise access action." }, { status: 400 });
}
