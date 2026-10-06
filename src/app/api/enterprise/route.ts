import { resolveTxt } from "node:dns/promises";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  automationExecutions,
  automationRules,
  identityDomains,
  identityProviders,
  organizationSecurityPolicies,
  orgUnits,
  permissionSets,
  scimTokens,
  sessions,
  userOrganizations,
  userPermissionAssignments,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, ORG_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enterpriseIdentityEncryptionConfigured, encryptEnterpriseSecret } from "@/lib/enterprise-secret";
import { organizationMfaReadiness } from "@/lib/enterprise-session";
import { discoverOidc } from "@/lib/oidc";
import { ROLE_GATE_PERMISSIONS } from "@/lib/permissions";
import { mintScimToken } from "@/lib/scim";
import { LIFECYCLE_TRIGGERS, normalizeLifecycleActions, validLifecycleConditions } from "@/lib/automation";
import { canonicalAppOrigin, enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";
import { randomToken, sha256 } from "@/lib/crypto";
import { clientIp, rateLimitDistributed } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DEFAULT_SECURITY_POLICY = {
  sessionIdleMinutes: 1440,
  sessionMaxHours: 336,
  maxActiveSessions: 10,
  requireMfa: false,
  ssoMode: "optional",
};

function integerInRange(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function normalizedDomain(value: unknown) {
  const domain = String(value ?? "").trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (!domain || domain.length > 180 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || !domain.includes(".")) {
    return null;
  }
  if (domain.includes("..") || domain.startsWith("www.")) return null;
  return domain;
}

function flattenedTxt(record: string[]) {
  return record.join("").trim();
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide workspace administrators can manage enterprise controls.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Enterprise controls require company-wide access." }, { status: 403 });

  const [policyRows, providers, domains, tokens, sets, assignments, members, rules, executions, units, mfaReadiness] = await Promise.all([
    db.select().from(organizationSecurityPolicies).where(eq(organizationSecurityPolicies.organizationId, organizationId)).limit(1),
    db.select().from(identityProviders).where(eq(identityProviders.organizationId, organizationId)).orderBy(desc(identityProviders.id)),
    db.select().from(identityDomains).where(eq(identityDomains.organizationId, organizationId)).orderBy(desc(identityDomains.id)),
    db.select().from(scimTokens).where(eq(scimTokens.organizationId, organizationId)).orderBy(desc(scimTokens.id)),
    db.select().from(permissionSets).where(eq(permissionSets.organizationId, organizationId)).orderBy(permissionSets.name),
    db.select().from(userPermissionAssignments).where(eq(userPermissionAssignments.organizationId, organizationId)),
    db.select({
      membershipId: userOrganizations.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: userOrganizations.role,
      orgUnitId: userOrganizations.orgUnitId,
      membershipActive: userOrganizations.active,
      active: users.active,
      localPasswordEnabled: users.localPasswordEnabled,
      totpEnabled: users.totpEnabled,
    }).from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId)),
    db.select().from(automationRules).where(eq(automationRules.organizationId, organizationId)).orderBy(desc(automationRules.id)),
    db.select().from(automationExecutions).where(eq(automationExecutions.organizationId, organizationId)).orderBy(desc(automationExecutions.id)).limit(30),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)).orderBy(orgUnits.name),
    organizationMfaReadiness(organizationId),
  ]);

  const origin = canonicalAppOrigin(request);
  return Response.json({
    securityPolicy: policyRows[0] ?? { organizationId, ...DEFAULT_SECURITY_POLICY },
    mfaReadiness,
    identityEncryptionConfigured: enterpriseIdentityEncryptionConfigured(),
    oidcCallbackUrl: origin + "/api/auth/sso/callback",
    scimBaseUrl: origin + "/api/scim/v2",
    identityProviders: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      issuer: provider.issuer,
      clientId: provider.clientId,
      scopes: provider.scopes,
      emailClaim: provider.emailClaim,
      enabled: provider.enabled,
      discoveryVerifiedAt: provider.discoveryVerifiedAt,
      clientSecretConfigured: provider.clientSecretEncrypted.startsWith("enc:v1:"),
    })),
    identityDomains: domains.map((domain) => ({
      id: domain.id,
      organizationId: domain.organizationId,
      providerId: domain.providerId,
      domain: domain.domain,
      verified: domain.verified,
      verifiedAt: domain.verifiedAt,
      createdAt: domain.createdAt,
    })),
    scimTokens: tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
    })),
    permissionSets: sets,
    permissionAssignments: assignments,
    members,
    automationRules: rules,
    automationExecutions: executions,
    orgUnits: units,
    availablePermissions: ROLE_GATE_PERMISSIONS,
    availableTriggers: LIFECYCLE_TRIGGERS,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Enterprise identity and automation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only company-wide workspace administrators can manage enterprise controls.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Enterprise controls require company-wide access." }, { status: 403 });

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const limited = await rateLimitDistributed(
    "enterprise-admin:" + user.id + ":" + organizationId + ":" + clientIp(request),
    { limit: 40, windowMs: 5 * 60_000 },
  );
  if (!limited.allowed) return Response.json({ error: "Too many enterprise-security changes. Try again later." }, { status: 429 });

  if (action === "save-security-policy") {
    const sessionIdleMinutes = integerInRange(body.sessionIdleMinutes, 15, 7 * 24 * 60);
    const sessionMaxHours = integerInRange(body.sessionMaxHours, 1, 30 * 24);
    const maxActiveSessions = integerInRange(body.maxActiveSessions, 1, 20);
    const requireMfa = Boolean(body.requireMfa);
    const ssoMode = String(body.ssoMode ?? "optional");
    if (sessionIdleMinutes === null || sessionMaxHours === null || maxActiveSessions === null || !["optional", "required"].includes(ssoMode)) {
      return Response.json({ error: "Session idle, maximum lifetime, concurrent-session limit, and SSO mode are invalid." }, { status: 400 });
    }
    if (sessionIdleMinutes > sessionMaxHours * 60) {
      return Response.json({ error: "Idle timeout cannot exceed the maximum session lifetime." }, { status: 400 });
    }

    if (requireMfa) {
      const readiness = await organizationMfaReadiness(organizationId);
      if (readiness.notReadyUserIds.length > 0) {
        return Response.json({
          error: "MFA cannot be required until every active local-password member has TOTP enabled.",
          notReadyCount: readiness.notReadyUserIds.length,
        }, { status: 409 });
      }
    }

    if (ssoMode === "required") {
      const enabledProviders = await db.select({ id: identityProviders.id }).from(identityProviders)
        .where(and(eq(identityProviders.organizationId, organizationId), eq(identityProviders.enabled, true)));
      if (enabledProviders.length === 0) return Response.json({ error: "Enable a verified OIDC provider before requiring SSO." }, { status: 409 });
      const providerIds = enabledProviders.map((provider) => provider.id);
      const verifiedDomains = await db.select({ id: identityDomains.id }).from(identityDomains)
        .where(and(
          eq(identityDomains.organizationId, organizationId),
          eq(identityDomains.verified, true),
          inArray(identityDomains.providerId, providerIds),
        ));
      if (verifiedDomains.length === 0) return Response.json({ error: "Verify an SSO email domain before requiring SSO." }, { status: 409 });
      if (user.authMethod !== "oidc" || !user.identityProviderId || !providerIds.includes(user.identityProviderId)) {
        return Response.json({
          error: "Sign in through this workspace's OIDC provider before switching SSO to required. This prevents administrator lockout.",
        }, { status: 409 });
      }
    }

    const [row] = await db.insert(organizationSecurityPolicies).values({
      organizationId,
      sessionIdleMinutes,
      sessionMaxHours,
      maxActiveSessions,
      requireMfa,
      ssoMode,
      updatedByUserId: user.id,
    }).onConflictDoUpdate({
      target: organizationSecurityPolicies.organizationId,
      set: {
        sessionIdleMinutes,
        sessionMaxHours,
        maxActiveSessions,
        requireMfa,
        ssoMode,
        updatedByUserId: user.id,
        updatedAt: new Date(),
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Enterprise security policy updated",
      resource: "Organization security policy",
      metadata: { sessionIdleMinutes, sessionMaxHours, maxActiveSessions, requireMfa, ssoMode },
    });
    return Response.json(row);
  }

  if (action === "create-oidc-provider") {
    if (!enterpriseIdentityEncryptionConfigured()) {
      return Response.json({ error: "Configure ENTERPRISE_IDENTITY_ENCRYPTION_KEY before storing an OIDC client secret." }, { status: 503 });
    }
    const name = String(body.name ?? "").trim();
    const issuer = String(body.issuer ?? "").trim();
    const clientId = String(body.clientId ?? "").trim();
    const clientSecret = String(body.clientSecret ?? "");
    const domain = normalizedDomain(body.domain);
    if (!name || !issuer || !clientId || !clientSecret || !domain) {
      return Response.json({ error: "Provider name, issuer, client ID, client secret, and company email domain are required." }, { status: 400 });
    }

    let discovery;
    try {
      discovery = await discoverOidc(issuer);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "OIDC discovery failed." }, { status: 422 });
    }

    const verificationToken = "linaw-sso-verification=" + randomToken(24);
    try {
      const result = await db.transaction(async (tx) => {
        const [provider] = await tx.insert(identityProviders).values({
          organizationId,
          name: name.slice(0, 120),
          issuer: discovery.issuer,
          clientId: clientId.slice(0, 240),
          clientSecretEncrypted: encryptEnterpriseSecret(clientSecret),
          authorizationEndpoint: discovery.authorization_endpoint,
          tokenEndpoint: discovery.token_endpoint,
          jwksUri: discovery.jwks_uri,
          scopes: "openid email profile",
          emailClaim: "email",
          enabled: false,
          discoveryVerifiedAt: new Date(),
          createdByUserId: user.id,
        }).returning();

        const [domainRow] = await tx.insert(identityDomains).values({
          organizationId,
          providerId: provider.id,
          domain,
          verificationTokenHash: sha256(verificationToken),
          verified: false,
        }).returning();
        return { provider, domain: domainRow };
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "OIDC provider configured",
        resource: result.provider.name,
        metadata: { providerId: result.provider.id, issuer: result.provider.issuer, domain },
      });
      return Response.json({
        provider: { ...result.provider, clientSecretEncrypted: undefined },
        domain: result.domain,
        dnsTxtRecord: verificationToken,
        warning: "Publish this exact TXT value on the company domain, then run domain verification. It is shown only in this response.",
      }, { status: 201 });
    } catch {
      return Response.json({ error: "Provider name or email domain is already configured." }, { status: 409 });
    }
  }

  if (action === "verify-domain") {
    const domainId = Number(body.domainId);
    if (!Number.isInteger(domainId)) return Response.json({ error: "domainId is required." }, { status: 400 });
    const [domain] = await db.select().from(identityDomains).where(and(
      eq(identityDomains.id, domainId),
      eq(identityDomains.organizationId, organizationId),
    )).limit(1);
    if (!domain) return Response.json({ error: "Identity domain not found." }, { status: 404 });
    let records: string[][];
    try {
      records = await resolveTxt(domain.domain);
    } catch {
      return Response.json({ error: "The domain's DNS TXT records could not be resolved yet." }, { status: 409 });
    }
    const verified = records.some((record) => sha256(flattenedTxt(record)) === domain.verificationTokenHash);
    if (!verified) return Response.json({ error: "The expected Linaw SSO verification TXT value was not found." }, { status: 409 });

    const [row] = await db.update(identityDomains).set({ verified: true, verifiedAt: new Date() })
      .where(eq(identityDomains.id, domain.id)).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "SSO domain verified",
      resource: domain.domain,
      metadata: { domainId: domain.id, providerId: domain.providerId },
    });
    return Response.json(row);
  }

  if (action === "set-provider-enabled") {
    const providerId = Number(body.providerId);
    const enabled = Boolean(body.enabled);
    if (!Number.isInteger(providerId)) return Response.json({ error: "providerId is required." }, { status: 400 });
    const [provider] = await db.select().from(identityProviders).where(and(
      eq(identityProviders.id, providerId),
      eq(identityProviders.organizationId, organizationId),
    )).limit(1);
    if (!provider) return Response.json({ error: "OIDC provider not found." }, { status: 404 });

    if (!enabled) {
      const [policy] = await db.select().from(organizationSecurityPolicies)
        .where(eq(organizationSecurityPolicies.organizationId, organizationId))
        .limit(1);
      if (policy?.ssoMode === "required") {
        const otherProviders = await db.select({ id: identityProviders.id }).from(identityProviders).where(and(
          eq(identityProviders.organizationId, organizationId),
          eq(identityProviders.enabled, true),
        ));
        if (otherProviders.filter((row) => row.id !== providerId).length === 0) {
          return Response.json({
            error: "This is the last enabled SSO provider while SSO is required. Switch the workspace to optional SSO before disabling it.",
          }, { status: 409 });
        }
      }
    }

    if (enabled) {
      const [verifiedDomain] = await db.select({ id: identityDomains.id }).from(identityDomains).where(and(
        eq(identityDomains.organizationId, organizationId),
        eq(identityDomains.providerId, providerId),
        eq(identityDomains.verified, true),
      )).limit(1);
      if (!verifiedDomain) return Response.json({ error: "Verify at least one provider email domain before enabling OIDC." }, { status: 409 });
      try {
        const discovery = await discoverOidc(provider.issuer);
        if (discovery.authorization_endpoint !== provider.authorizationEndpoint || discovery.token_endpoint !== provider.tokenEndpoint || discovery.jwks_uri !== provider.jwksUri) {
          return Response.json({ error: "OIDC discovery metadata changed. Recreate the provider after reviewing the new endpoints." }, { status: 409 });
        }
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "OIDC discovery revalidation failed." }, { status: 422 });
      }
    }
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.update(identityProviders).set({ enabled, updatedAt: new Date() })
        .where(eq(identityProviders.id, providerId)).returning();
      let revokedSessions = 0;
      if (!enabled) {
        const revoked = await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
          eq(sessions.identityProviderId, providerId),
          isNull(sessions.revokedAt),
        )).returning({ id: sessions.id });
        revokedSessions = revoked.length;
      }
      return { row, revokedSessions };
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: enabled ? "OIDC provider enabled" : "OIDC provider disabled",
      resource: provider.name,
      metadata: { providerId, revokedSessions: result.revokedSessions },
    });
    return Response.json({ id: result.row.id, enabled: result.row.enabled, revokedSessions: result.revokedSessions });
  }

  if (action === "create-scim-token") {
    const name = String(body.name ?? "").trim();
    if (!name) return Response.json({ error: "SCIM token name is required." }, { status: 400 });
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

  if (action === "revoke-scim-token") {
    const tokenId = Number(body.tokenId);
    if (!Number.isInteger(tokenId)) return Response.json({ error: "tokenId is required." }, { status: 400 });
    const [row] = await db.update(scimTokens).set({ revokedAt: new Date() }).where(and(
      eq(scimTokens.id, tokenId),
      eq(scimTokens.organizationId, organizationId),
    )).returning();
    if (!row) return Response.json({ error: "SCIM token not found." }, { status: 404 });
    await recordAuditEvent({ organizationId, actor: user.name, action: "SCIM token revoked", resource: row.name, metadata: { prefix: row.prefix } });
    return Response.json({ ok: true });
  }

  if (action === "save-permission-set") {
    const id = body.id ? Number(body.id) : null;
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const requested = Array.isArray(body.permissions) ? body.permissions.filter((value: unknown): value is string => typeof value === "string") : [];
    const permissions = [...new Set(requested.filter((permission: string) => (ROLE_GATE_PERMISSIONS as readonly string[]).includes(permission)))];
    if (!name || permissions.length === 0) {
      return Response.json({ error: "Permission-set name and at least one valid permission are required." }, { status: 400 });
    }
    if (id) {
      const nextActive = body.active === undefined ? true : Boolean(body.active);
      const [myMembership] = await db.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
        eq(userOrganizations.userId, user.id),
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.active, true),
      )).limit(1);
      if (myMembership) {
        const [myAssignment] = await db.select({ id: userPermissionAssignments.id }).from(userPermissionAssignments).where(and(
          eq(userPermissionAssignments.organizationId, organizationId),
          eq(userPermissionAssignments.userOrganizationId, myMembership.id),
          eq(userPermissionAssignments.permissionSetId, id),
        )).limit(1);
        if (myAssignment && (!nextActive || !permissions.includes("org.admin"))) {
          return Response.json({
            error: "You cannot edit your own active permission restriction so that it removes organization administration. Clear your assignment first or have another administrator change it.",
          }, { status: 409 });
        }
      }

      const [row] = await db.update(permissionSets).set({
        name: name.slice(0, 120),
        description: description.slice(0, 4000) || null,
        permissions,
        active: nextActive,
        updatedAt: new Date(),
      }).where(and(eq(permissionSets.id, id), eq(permissionSets.organizationId, organizationId))).returning();
      if (!row) return Response.json({ error: "Permission set not found." }, { status: 404 });
      await recordAuditEvent({ organizationId, actor: user.name, action: "Permission set updated", resource: row.name, metadata: { permissionSetId: row.id, permissions } });
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
      await recordAuditEvent({ organizationId, actor: user.name, action: "Permission set created", resource: row.name, metadata: { permissionSetId: row.id, permissions } });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A permission set with this name already exists." }, { status: 409 });
    }
  }

  if (action === "assign-permission-set") {
    const membershipId = Number(body.membershipId);
    const permissionSetId = body.permissionSetId ? Number(body.permissionSetId) : null;
    if (!Number.isInteger(membershipId)) return Response.json({ error: "membershipId is required." }, { status: 400 });
    const [membership] = await db.select().from(userOrganizations).where(and(
      eq(userOrganizations.id, membershipId),
      eq(userOrganizations.organizationId, organizationId),
    )).limit(1);
    if (!membership) return Response.json({ error: "Workspace membership not found." }, { status: 404 });

    if (!permissionSetId) {
      await db.delete(userPermissionAssignments).where(and(
        eq(userPermissionAssignments.organizationId, organizationId),
        eq(userPermissionAssignments.userOrganizationId, membershipId),
      ));
      await recordAuditEvent({ organizationId, actor: user.name, action: "Custom permission set cleared", resource: "Membership #" + membershipId, metadata: { membershipId } });
      return Response.json({ ok: true, permissionSetId: null });
    }

    const [permissionSet] = await db.select().from(permissionSets).where(and(
      eq(permissionSets.id, permissionSetId),
      eq(permissionSets.organizationId, organizationId),
      eq(permissionSets.active, true),
    )).limit(1);
    if (!permissionSet) return Response.json({ error: "Active permission set not found." }, { status: 404 });
    const permissionValues = Array.isArray(permissionSet.permissions)
      ? permissionSet.permissions.filter((value: unknown): value is string => typeof value === "string")
      : [];
    if (membership.userId === user.id && !permissionValues.includes("org.admin")) {
      return Response.json({
        error: "You cannot assign yourself a permission restriction that removes organization administration.",
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
      action: "Custom permission set assigned",
      resource: "Membership #" + membershipId,
      metadata: { membershipId, permissionSetId, role: membership.role },
    });
    return Response.json(row);
  }

  if (action === "save-automation-rule") {
    const id = body.id ? Number(body.id) : null;
    const name = String(body.name ?? "").trim();
    const trigger = String(body.trigger ?? "");
    const conditions = body.conditions ?? {};
    const actions = normalizeLifecycleActions(body.actions);
    if (!name || !(LIFECYCLE_TRIGGERS as readonly string[]).includes(trigger) || !validLifecycleConditions(conditions) || !actions) {
      return Response.json({ error: "Rule name, lifecycle trigger, supported conditions, and at least one valid action are required." }, { status: 400 });
    }

    if (actions.some((item) => item.type === "revoke_sessions") && trigger !== "employee.separated") {
      return Response.json({ error: "Session revocation automation is allowed only for employee separation." }, { status: 400 });
    }

    if (id) {
      const [row] = await db.update(automationRules).set({
        name: name.slice(0, 160),
        trigger,
        conditions,
        actions,
        active: body.active === undefined ? true : Boolean(body.active),
        updatedAt: new Date(),
      }).where(and(eq(automationRules.id, id), eq(automationRules.organizationId, organizationId))).returning();
      if (!row) return Response.json({ error: "Automation rule not found." }, { status: 404 });
      await recordAuditEvent({ organizationId, actor: user.name, action: "Lifecycle automation updated", resource: row.name, metadata: { ruleId: row.id, trigger } });
      return Response.json(row);
    }

    try {
      const [row] = await db.insert(automationRules).values({
        organizationId,
        name: name.slice(0, 160),
        trigger,
        conditions,
        actions,
        active: true,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({ organizationId, actor: user.name, action: "Lifecycle automation created", resource: row.name, metadata: { ruleId: row.id, trigger } });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "An automation rule with this name already exists." }, { status: 409 });
    }
  }

  if (action === "set-automation-active") {
    const ruleId = Number(body.ruleId);
    const active = Boolean(body.active);
    if (!Number.isInteger(ruleId)) return Response.json({ error: "ruleId is required." }, { status: 400 });
    const [row] = await db.update(automationRules).set({ active, updatedAt: new Date() }).where(and(
      eq(automationRules.id, ruleId),
      eq(automationRules.organizationId, organizationId),
    )).returning();
    if (!row) return Response.json({ error: "Automation rule not found." }, { status: 404 });
    await recordAuditEvent({ organizationId, actor: user.name, action: active ? "Lifecycle automation enabled" : "Lifecycle automation disabled", resource: row.name, metadata: { ruleId } });
    return Response.json(row);
  }

  return Response.json({ error: "Unknown enterprise action." }, { status: 400 });
}
