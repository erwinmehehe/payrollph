import { and, asc, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, scimIdentities, sessions, userOrganizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { randomToken } from "@/lib/crypto";
import { authenticateScim, scimError } from "@/lib/scim";
import { recordAuditEvent } from "@/lib/audit";
import { EnterpriseProvisioningError, parseScimActive, parseScimMemberRole, scimProvisioningOrgUnit, shouldRevokeScimSessions } from "@/lib/enterprise-identity-policy";

export const dynamic = "force-dynamic";

const SAFE_SCIM_ROLES = ["employee", "manager", "hr", "payroll", "checker"] as const;

type EnterpriseExtension = {
  department?: string;
  employeeNumber?: string;
};

function scimRole(value: unknown) {
  return parseScimMemberRole(value);
}

function resource(input: {
  scimId: number;
  externalId: string;
  user: { email: string; name: string; active: boolean; createdAt: Date };
  membership: { role: string; orgUnitId: number | null; active: boolean };
  identityActive?: boolean;
  unitName?: string | null;
  employeeNo?: string | null;
}) {
  return {
    schemas: [
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    ],
    id: String(input.scimId),
    externalId: input.externalId,
    userName: input.user.email,
    displayName: input.user.name,
    name: { formatted: input.user.name },
    active: input.user.active && input.membership.active && input.identityActive !== false,
    roles: [{ value: input.membership.role, primary: true }],
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      department: input.unitName ?? undefined,
      employeeNumber: input.employeeNo ?? undefined,
    },
    meta: {
      resourceType: "User",
      created: input.user.createdAt.toISOString(),
      location: "/api/scim/v2/Users/" + input.scimId,
    },
  };
}

async function resolvedUnit(organizationId: number, department: string | undefined) {
  if (!department?.trim()) return null;
  const value = department.trim();
  const [unit] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.organizationId, organizationId),
    ilike(orgUnits.name, value),
  )).limit(1);
  if (unit) return unit;
  const [byCode] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.organizationId, organizationId),
    ilike(orgUnits.code, value),
  )).limit(1);
  return byCode ?? null;
}

async function resolvedEmployee(organizationId: number, employeeNumber: string | undefined) {
  // Never bind payroll or ESS identity from an email coincidence.
  if (!employeeNumber?.trim()) return null;
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.employeeNo, employeeNumber.trim()),
  )).limit(1);
  return employee ?? null;
}

export async function GET(request: Request) {
  const auth = await authenticateScim(request);
  if (!auth.ok) return scimError(auth.status, auth.error);

  const url = new URL(request.url);
  const startIndex = Math.max(1, Number(url.searchParams.get("startIndex") ?? 1) || 1);
  const count = Math.min(100, Math.max(1, Number(url.searchParams.get("count") ?? 100) || 100));
  const filter = String(url.searchParams.get("filter") ?? "").trim();
  const emailMatch = /^userName\s+eq\s+"([^"]+)"$/i.exec(filter);

  const identities = await db.select().from(scimIdentities)
    .where(eq(scimIdentities.organizationId, auth.organizationId))
    .orderBy(asc(scimIdentities.id));

  let rows = identities;
  if (emailMatch) {
    const email = emailMatch[1].trim().toLowerCase();
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    rows = user ? identities.filter((row) => row.userId === user.id) : [];
  } else if (filter) {
    return scimError(400, 'Only the filter userName eq "email@example.com" is supported.');
  }

  const page = rows.slice(startIndex - 1, startIndex - 1 + count);
  const resources = [];
  for (const identity of page) {
    const [user] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
    const [membership] = await db.select().from(userOrganizations).where(and(
      eq(userOrganizations.userId, identity.userId),
      eq(userOrganizations.organizationId, auth.organizationId),
    )).limit(1);
    if (!user || !membership) continue;
    const unit = membership.orgUnitId
      ? (await db.select().from(orgUnits).where(and(
          eq(orgUnits.id, membership.orgUnitId),
          eq(orgUnits.organizationId, auth.organizationId),
        )).limit(1))[0]
      : null;
    const workerId = membership.workerEmployeeId ?? user.employeeId;
    const employee = workerId
      ? (await db.select({ employeeNo: employees.employeeNo }).from(employees).where(and(
          eq(employees.id, workerId),
          eq(employees.organizationId, auth.organizationId),
        )).limit(1))[0]
      : null;
    resources.push(resource({
      scimId: identity.id,
      externalId: identity.externalId,
      user,
      membership,
      identityActive: identity.active,
      unitName: unit?.name ?? null,
      employeeNo: employee?.employeeNo ?? null,
    }));
  }

  return Response.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: rows.length,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  }, { headers: { "Content-Type": "application/scim+json" } });
}

export async function POST(request: Request) {
  const auth = await authenticateScim(request);
  if (!auth.ok) return scimError(auth.status, auth.error);
  const body = await request.json().catch(() => ({}));

  const email = String(body.userName ?? "").trim().toLowerCase();
  const name = String(body.displayName ?? body.name?.formatted ?? [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ")).trim();
  const externalId = String(body.externalId ?? email).trim();
  let active: boolean;
  let role: (typeof SAFE_SCIM_ROLES)[number];
  try {
    active = body.active === undefined ? true : parseScimActive(body.active);
    role = body.roles === undefined && body.role === undefined
      ? "employee" : scimRole(body.roles ?? body.role);
  } catch (error) {
    return scimError(400, error instanceof Error ? error.message : "Invalid SCIM active or role.");
  }
  const enterprise = (body["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"] ?? {}) as EnterpriseExtension;

  if (!email || !email.includes("@") || email.length > 180 || !name || !externalId) {
    return scimError(400, "userName, display name, and externalId are required.");
  }

  const [existingIdentity] = await db.select().from(scimIdentities).where(and(
    eq(scimIdentities.organizationId, auth.organizationId),
    eq(scimIdentities.externalId, externalId),
  )).limit(1);
  if (existingIdentity) return scimError(409, "A SCIM user with this externalId already exists.");

  const [emailOwner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (emailOwner && !emailOwner.active) {
    return scimError(409, "An inactive global Linaw account already uses this userName. Reactivation requires an account administrator.");
  }
  if (enterprise.department !== undefined && !enterprise.department.trim()) {
    return scimError(400, "SCIM department cannot be blank.");
  }
  const employee = await resolvedEmployee(auth.organizationId, enterprise.employeeNumber);
  if (enterprise.employeeNumber?.trim() && !employee) {
    return scimError(404, "SCIM employeeNumber does not match an authoritative employee.");
  }
  const unit = await resolvedUnit(auth.organizationId, enterprise.department);
  if (enterprise.department?.trim() && !unit) {
    return scimError(404, "SCIM department does not match an organization unit.");
  }
  const inferredUnit = unit ?? (employee?.orgUnitId
    ? (await db.select().from(orgUnits).where(and(
        eq(orgUnits.organizationId, auth.organizationId),
        eq(orgUnits.id, employee.orgUnitId),
      )).limit(1))[0] ?? null
    : null);

  try {
    const created = await db.transaction(async (tx) => {
      // Serialize account linking across competing SCIM providers. A global
      // account's identity fields cannot be overwritten by another employer.
      if (emailOwner) await tx.execute(sql`select id from users where id = ${emailOwner.id} for update`);
      const activeElsewhere = emailOwner ? await tx.select({ id: userOrganizations.id })
        .from(userOrganizations).where(and(
          eq(userOrganizations.userId, emailOwner.id),
          ne(userOrganizations.organizationId, auth.organizationId),
          eq(userOrganizations.active, true),
        )).limit(1) : [];
      const shared = activeElsewhere.length > 0;
      let user = emailOwner;
      const [existingMembership] = user
        ? await tx.select().from(userOrganizations).where(and(
            eq(userOrganizations.userId, user.id),
            eq(userOrganizations.organizationId, auth.organizationId),
          )).limit(1)
        : [];
      const orgUnitId = scimProvisioningOrgUnit({
        requestedUnitId: inferredUnit?.id ?? null,
        requestedRole: role,
        existingMembership: existingMembership ?? null,
      });
      if (!user) {
        [user] = await tx.insert(users).values({
          email,
          name: name.slice(0, 120),
          passwordHash: hashPassword(randomToken(48)),
          role,
          active: true,
          localPasswordEnabled: false,
          employeeId: employee?.id ?? null,
        }).returning();
      } else if (!shared) {
        if (employee?.id && user.employeeId && user.employeeId !== employee.id) {
          throw new EnterpriseProvisioningError("Existing ESS worker identity differs. Rebinding requires an account administrator.");
        }
        [user] = await tx.update(users).set({
          name: name.slice(0, 120),
          ...(employee?.id && !user.employeeId ? { employeeId: employee.id } : {}),
        }).where(eq(users.id, user.id)).returning();
      }
      if (!user) throw new Error("SCIM user creation returned no account.");

      let membership = existingMembership;
      if (membership) {
        if (employee?.id && membership.workerEmployeeId && membership.workerEmployeeId !== employee.id) {
          throw new EnterpriseProvisioningError("An existing SCIM worker link cannot be changed without account reconciliation.");
        }
        [membership] = await tx.update(userOrganizations).set({
          role, active, orgUnitId,
          ...(employee ? { workerEmployeeId: employee.id } : {}),
        }).where(eq(userOrganizations.id, membership.id)).returning();
        if (shouldRevokeScimSessions({
          activeChanged: membership.active !== existingMembership.active,
          roleChanged: membership.role !== existingMembership.role,
          orgUnitChanged: membership.orgUnitId !== existingMembership.orgUnitId,
          workerLinkChanged: membership.workerEmployeeId !== existingMembership.workerEmployeeId,
          emailChanged: false, nameChanged: false,
        })) {
          await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
            eq(sessions.userId, user.id), isNull(sessions.revokedAt),
          ));
        }
      } else {
        [membership] = await tx.insert(userOrganizations).values({
          userId: user.id, organizationId: auth.organizationId,
          role, active, orgUnitId, workerEmployeeId: employee?.id ?? null,
        }).returning();
      }
      if (!membership) throw new Error("SCIM membership creation returned no membership.");

      const [identity] = await tx.insert(scimIdentities).values({
        organizationId: auth.organizationId,
        userId: user.id,
        externalId: externalId.slice(0, 240),
        active,
        lastSyncedAt: new Date(),
      }).returning();
      if (!identity) throw new Error("SCIM identity creation returned no record.");

      return { user, membership, identity, shared };
    });

    await recordAuditEvent({
      organizationId: auth.organizationId,
      actor: "SCIM token #" + auth.tokenId,
      action: "SCIM user provisioned",
      resource: email,
      metadata: {
        scimIdentityId: created.identity.id, userId: created.user.id, role,
        orgUnitId: created.membership.orgUnitId, employeeId: created.membership.workerEmployeeId,
        sharedAccount: created.shared,
      },
    });

    return Response.json(resource({
      scimId: created.identity.id,
      externalId: created.identity.externalId,
      user: created.user,
      membership: created.membership,
      identityActive: created.identity.active,
      unitName: inferredUnit?.name ?? null,
      employeeNo: employee?.employeeNo ?? null,
    }), {
      status: 201,
      headers: {
        "Content-Type": "application/scim+json",
        Location: "/api/scim/v2/Users/" + created.identity.id,
      },
    });
  } catch (error) {
    return scimError(409, error instanceof EnterpriseProvisioningError
      ? error.message
      : "The SCIM user could not be provisioned because the email or membership conflicts with an existing account.");
  }
}
