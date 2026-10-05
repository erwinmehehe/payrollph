import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, scimIdentities, userOrganizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { randomToken } from "@/lib/crypto";
import { authenticateScim, scimError } from "@/lib/scim";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const SAFE_SCIM_ROLES = ["employee", "manager", "hr", "payroll", "checker"] as const;

type EnterpriseExtension = {
  department?: string;
  employeeNumber?: string;
};

function scimRole(value: unknown) {
  const candidate = typeof value === "string" ? value.toLowerCase() : "";
  return (SAFE_SCIM_ROLES as readonly string[]).includes(candidate) ? candidate : "employee";
}

function resource(input: {
  scimId: number;
  externalId: string;
  user: { email: string; name: string; active: boolean; createdAt: Date };
  membership: { role: string; orgUnitId: number | null; active: boolean };
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
    active: input.user.active && input.membership.active,
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

async function resolvedEmployee(organizationId: number, employeeNumber: string | undefined, email: string) {
  if (employeeNumber?.trim()) {
    const [employee] = await db.select().from(employees).where(and(
      eq(employees.organizationId, organizationId),
      eq(employees.employeeNo, employeeNumber.trim()),
    )).limit(1);
    if (employee) return employee;
  }
  const [byEmail] = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    ilike(employees.email, email),
  )).limit(1);
  return byEmail ?? null;
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
      ? (await db.select().from(orgUnits).where(eq(orgUnits.id, membership.orgUnitId)).limit(1))[0]
      : null;
    const employee = user.employeeId
      ? (await db.select({ employeeNo: employees.employeeNo }).from(employees).where(eq(employees.id, user.employeeId)).limit(1))[0]
      : null;
    resources.push(resource({
      scimId: identity.id,
      externalId: identity.externalId,
      user,
      membership,
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
  const active = body.active !== false;
  const role = scimRole(Array.isArray(body.roles) ? body.roles[0]?.value : body.role);
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
  const unit = await resolvedUnit(auth.organizationId, enterprise.department);
  const employee = await resolvedEmployee(auth.organizationId, enterprise.employeeNumber, email);

  try {
    const created = await db.transaction(async (tx) => {
      let user = emailOwner;
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
      } else {
        if (employee?.id && user.employeeId && user.employeeId !== employee.id) {
          throw new Error("Existing Linaw user is already linked to a different employee record.");
        }
        const [updated] = await tx.update(users).set({
          name: name.slice(0, 120),
          ...(employee?.id && !user.employeeId ? { employeeId: employee.id } : {}),
        }).where(eq(users.id, user.id)).returning();
        user = updated;
      }
      if (!user) throw new Error("SCIM user creation returned no account.");

      const [existingMembership] = await tx.select().from(userOrganizations).where(and(
        eq(userOrganizations.userId, user.id),
        eq(userOrganizations.organizationId, auth.organizationId),
      )).limit(1);
      let membership = existingMembership;
      if (membership) {
        [membership] = await tx.update(userOrganizations).set({
          role,
          active,
          orgUnitId: unit?.id ?? membership.orgUnitId,
        }).where(eq(userOrganizations.id, membership.id)).returning();
      } else {
        [membership] = await tx.insert(userOrganizations).values({
          userId: user.id,
          organizationId: auth.organizationId,
          role,
          active,
          orgUnitId: unit?.id ?? null,
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

      return { user, membership, identity };
    });

    await recordAuditEvent({
      organizationId: auth.organizationId,
      actor: "SCIM token #" + auth.tokenId,
      action: "SCIM user provisioned",
      resource: email,
      metadata: { scimIdentityId: created.identity.id, userId: created.user.id, role, orgUnitId: created.membership.orgUnitId, employeeId: created.user.employeeId },
    });

    return Response.json(resource({
      scimId: created.identity.id,
      externalId: created.identity.externalId,
      user: created.user,
      membership: created.membership,
      unitName: unit?.name ?? null,
      employeeNo: employee?.employeeNo ?? null,
    }), {
      status: 201,
      headers: {
        "Content-Type": "application/scim+json",
        Location: "/api/scim/v2/Users/" + created.identity.id,
      },
    });
  } catch {
    return scimError(409, "The SCIM user could not be provisioned because the email or membership conflicts with an existing account.");
  }
}
