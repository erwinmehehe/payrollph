import { and, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, scimIdentities, sessions, userOrganizations, users } from "@/db/schema";
import { authenticateScim, scimError } from "@/lib/scim";
import { recordAuditEvent } from "@/lib/audit";
import { assertScimGlobalIdentityChange, EnterpriseProvisioningError, parseScimActive, parseScimMemberRole, scimProvisioningOrgUnit, shouldRevokeScimSessions } from "@/lib/enterprise-identity-policy";

export const dynamic = "force-dynamic";

const SAFE_SCIM_ROLES = ["employee", "manager", "hr", "payroll", "checker"] as const;

async function loadResource(organizationId: number, scimId: number) {
  const [identity] = await db.select().from(scimIdentities).where(and(
    eq(scimIdentities.id, scimId),
    eq(scimIdentities.organizationId, organizationId),
  )).limit(1);
  if (!identity) return null;
  const [user] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
  const [membership] = await db.select().from(userOrganizations).where(and(
    eq(userOrganizations.userId, identity.userId),
    eq(userOrganizations.organizationId, organizationId),
  )).limit(1);
  if (!user || !membership) return null;
  const unit = membership.orgUnitId
    ? (await db.select().from(orgUnits).where(and(
        eq(orgUnits.id, membership.orgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1))[0]
    : null;
  const workerId = membership.workerEmployeeId ?? user.employeeId;
  const employee = workerId
    ? (await db.select({ employeeNo: employees.employeeNo }).from(employees).where(and(
        eq(employees.id, workerId),
        eq(employees.organizationId, organizationId),
      )).limit(1))[0]
    : null;
  return { identity, user, membership, unit, employee };
}

function responseResource(row: NonNullable<Awaited<ReturnType<typeof loadResource>>>) {
  return {
    schemas: [
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    ],
    id: String(row.identity.id),
    externalId: row.identity.externalId,
    userName: row.user.email,
    displayName: row.user.name,
    name: { formatted: row.user.name },
    active: row.user.active && row.membership.active && row.identity.active,
    roles: [{ value: row.membership.role, primary: true }],
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
      department: row.unit?.name ?? undefined,
      employeeNumber: row.employee?.employeeNo ?? undefined,
    },
    meta: { resourceType: "User", location: "/api/scim/v2/Users/" + row.identity.id },
  };
}

async function unitForDepartment(organizationId: number, value: string) {
  const [byName] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.organizationId, organizationId),
    ilike(orgUnits.name, value),
  )).limit(1);
  if (byName) return byName;
  const [byCode] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.organizationId, organizationId),
    ilike(orgUnits.code, value),
  )).limit(1);
  return byCode ?? null;
}

async function employeeForNumber(organizationId: number, value: string) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.organizationId, organizationId),
    eq(employees.employeeNo, value),
  )).limit(1);
  return employee ?? null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth.ok) return scimError(auth.status, auth.error);
  const { id } = await context.params;
  const scimId = Number(id);
  if (!Number.isInteger(scimId)) return scimError(400, "SCIM user id is invalid.");
  const row = await loadResource(auth.organizationId, scimId);
  if (!row) return scimError(404, "SCIM user not found.");
  return Response.json(responseResource(row), { headers: { "Content-Type": "application/scim+json" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth.ok) return scimError(auth.status, auth.error);
  const { id } = await context.params;
  const scimId = Number(id);
  if (!Number.isInteger(scimId)) return scimError(400, "SCIM user id is invalid.");
  const current = await loadResource(auth.organizationId, scimId);
  if (!current) return scimError(404, "SCIM user not found.");

  const body = await request.json().catch(() => ({}));
  const operations = Array.isArray(body.Operations) ? body.Operations : [];
  if (operations.length === 0 || operations.length > 20) return scimError(400, "SCIM PATCH requires one to twenty Operations.");

  let email: string | undefined;
  let name: string | undefined;
  let active: boolean | undefined;
  let role: (typeof SAFE_SCIM_ROLES)[number] | undefined;
  let department: string | undefined;
  let employeeNumber: string | undefined;

  for (const raw of operations) {
    if (!raw || typeof raw !== "object") return scimError(400, "Invalid SCIM PATCH operation.");
    const op = raw as { op?: unknown; path?: unknown; value?: unknown };
    const verb = String(op.op ?? "").toLowerCase();
    if (!["add", "replace"].includes(verb)) return scimError(400, "Only SCIM add and replace operations are supported.");
    const path = String(op.path ?? "").toLowerCase();
    const value = op.value;

    if (!path && value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      if (object.userName !== undefined) email = String(object.userName).trim().toLowerCase();
      if (object.displayName !== undefined) name = String(object.displayName).trim();
      try {
        if (object.active !== undefined) active = parseScimActive(object.active);
        if (object.roles !== undefined) role = parseScimMemberRole(object.roles);
      } catch (error) {
        return scimError(400, error instanceof Error ? error.message : "Invalid SCIM role or active value.");
      }
      continue;
    }
    if (path === "active") {
      try {
        active = parseScimActive(value);
      } catch (error) {
        return scimError(400, error instanceof Error ? error.message : "Invalid SCIM active value.");
      }
      continue;
    }
    if (path === "username") { email = String(value ?? "").trim().toLowerCase(); continue; }
    if (path === "displayname" || path === "name.formatted") { name = String(value ?? "").trim(); continue; }
    if (path === "roles") {
      try {
        role = parseScimMemberRole(value);
      } catch (error) {
        return scimError(400, error instanceof Error ? error.message : "Requested SCIM role is not allowed.");
      }
      continue;
    }
    if (path.endsWith(":user:department") || path.endsWith(".department")) {
      department = String(value ?? "").trim();
      continue;
    }
    if (path.endsWith(":user:employeenumber") || path.endsWith(".employeenumber")) {
      employeeNumber = String(value ?? "").trim();
      continue;
    }
    return scimError(400, "Unsupported SCIM PATCH path: " + path);
  }

  if (email !== undefined && (!email.includes("@") || email.length > 180)) return scimError(400, "userName must be a valid work email.");
  if (name !== undefined && (!name || name.length > 120)) return scimError(400, "displayName is invalid.");
  if (department !== undefined && !department) return scimError(400, "SCIM department cannot be cleared into company-wide scope.");
  if (employeeNumber !== undefined && !employeeNumber) return scimError(400, "SCIM employeeNumber cannot be blank.");

  const unit = department ? await unitForDepartment(auth.organizationId, department) : undefined;
  if (department && !unit) return scimError(404, "SCIM department does not match an organization unit.");
  const employee = employeeNumber ? await employeeForNumber(auth.organizationId, employeeNumber) : undefined;
  if (employeeNumber && !employee) return scimError(404, "SCIM employeeNumber does not match an employee record.");

  if (email && email !== current.user.email.toLowerCase()) {
    const [conflict] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (conflict && conflict.id !== current.user.id) return scimError(409, "Another Linaw account already uses this userName.");
  }

  try {
    await db.transaction(async (tx) => {
      // A user may belong to multiple employers. Serialize global-account
      // changes and reject stale SCIM updates that could overwrite another
      // organization's identity. Tenant role and department remain independent.
      await tx.execute(sql`select id from users where id = ${current.user.id} for update`);
      const [[liveUser], [liveMembership], [liveIdentity], otherMemberships] = await Promise.all([
        tx.select().from(users).where(eq(users.id, current.user.id)).limit(1),
        tx.select().from(userOrganizations).where(and(
          eq(userOrganizations.id, current.membership.id),
          eq(userOrganizations.organizationId, auth.organizationId),
          eq(userOrganizations.userId, current.user.id),
        )).limit(1),
        tx.select().from(scimIdentities).where(and(
          eq(scimIdentities.id, scimId),
          eq(scimIdentities.organizationId, auth.organizationId),
          eq(scimIdentities.userId, current.user.id),
        )).limit(1),
        tx.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
          eq(userOrganizations.userId, current.user.id),
          ne(userOrganizations.organizationId, auth.organizationId),
          eq(userOrganizations.active, true),
        )).limit(1),
      ]);
      if (!liveUser || !liveMembership || !liveIdentity
        || liveUser.email !== current.user.email
        || liveMembership.role !== current.membership.role
        || liveMembership.orgUnitId !== current.membership.orgUnitId
        || liveMembership.workerEmployeeId !== current.membership.workerEmployeeId
        || liveMembership.active !== current.membership.active
        || liveIdentity.active !== current.identity.active) {
        throw new EnterpriseProvisioningError(
          "The SCIM account or organization membership changed. Refresh the user and retry.",
        );
      }

      const sharedAcrossOrganizations = otherMemberships.length > 0;
      const emailChanged = email !== undefined && email !== liveUser.email;
      const nameChanged = name !== undefined && name !== liveUser.name;
      const existingWorkerId = liveMembership.workerEmployeeId;
      if (employee && existingWorkerId && existingWorkerId !== employee.id) {
        throw new EnterpriseProvisioningError(
          "SCIM cannot reassign an already verified worker identity. An account administrator must reconcile this link.",
        );
      }
      const globalWorkerLinkChanged = !sharedAcrossOrganizations
        && !!employee && liveUser.employeeId !== employee.id;
      if (globalWorkerLinkChanged && liveUser.employeeId != null) {
        throw new EnterpriseProvisioningError(
          "The global ESS worker identity cannot be replaced through SCIM.",
        );
      }
      assertScimGlobalIdentityChange({
        sharedAcrossOrganizations, emailChanged, nameChanged,
        employeeLinkChanged: false, // tenant employee link is not a global account mutation
      });
      const nextOrgUnitId = role !== undefined || unit
        ? scimProvisioningOrgUnit({
            requestedUnitId: unit?.id ?? null,
            requestedRole: role ?? parseScimMemberRole(liveMembership.role),
            existingMembership: liveMembership,
          })
        : liveMembership.orgUnitId;
      const nextRole = role ?? liveMembership.role;
      const nextActive = active ?? liveMembership.active;
      const nextWorkerId = employee?.id ?? existingWorkerId;

      if (emailChanged || nameChanged || globalWorkerLinkChanged) {
        await tx.update(users).set({
          ...(emailChanged ? { email } : {}),
          ...(nameChanged ? { name } : {}),
          ...(globalWorkerLinkChanged ? { employeeId: employee?.id } : {}),
        }).where(eq(users.id, liveUser.id));
      }
      await tx.update(userOrganizations).set({
        role: nextRole,
        orgUnitId: nextOrgUnitId,
        active: nextActive,
        workerEmployeeId: nextWorkerId,
      }).where(and(
        eq(userOrganizations.id, liveMembership.id),
        eq(userOrganizations.organizationId, auth.organizationId),
      ));
      await tx.update(scimIdentities).set({
        ...(active !== undefined ? { active } : {}),
        lastSyncedAt: new Date(),
      }).where(and(
        eq(scimIdentities.id, liveIdentity.id),
        eq(scimIdentities.organizationId, auth.organizationId),
      ));

      if (active === false || shouldRevokeScimSessions({
        activeChanged: nextActive !== liveMembership.active,
        roleChanged: nextRole !== liveMembership.role,
        orgUnitChanged: nextOrgUnitId !== liveMembership.orgUnitId,
        workerLinkChanged: nextWorkerId !== existingWorkerId,
        emailChanged,
        nameChanged,
      })) {
        // Sessions are global. Fail closed on any access boundary change;
        // users with another employer membership may sign in again there.
        await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
          eq(sessions.userId, current.user.id),
          isNull(sessions.revokedAt),
        ));
      }
    });
  } catch (error) {
    return scimError(409, error instanceof EnterpriseProvisioningError
      ? error.message : "SCIM user changed during the update.");
  }

  const updated = await loadResource(auth.organizationId, scimId);
  if (!updated) return scimError(409, "SCIM user became inconsistent after update.");

  await recordAuditEvent({
    organizationId: auth.organizationId,
    actor: "SCIM token #" + auth.tokenId,
    action: active === false ? "SCIM user deactivated" : "SCIM user updated",
    resource: updated.user.email,
    metadata: {
      scimIdentityId: scimId, userId: updated.user.id, role: updated.membership.role,
      orgUnitId: updated.membership.orgUnitId, employeeId: updated.membership.workerEmployeeId,
      authorizationChanged: active !== undefined || role !== undefined || department !== undefined
        || employeeNumber !== undefined || email !== undefined,
    },
  });

  return Response.json(responseResource(updated), { headers: { "Content-Type": "application/scim+json" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth.ok) return scimError(auth.status, auth.error);
  const { id } = await context.params;
  const scimId = Number(id);
  if (!Number.isInteger(scimId)) return scimError(400, "SCIM user id is invalid.");
  const current = await loadResource(auth.organizationId, scimId);
  if (!current) return scimError(404, "SCIM user not found.");

  await db.transaction(async (tx) => {
    await tx.update(userOrganizations).set({ active: false }).where(eq(userOrganizations.id, current.membership.id));
    await tx.update(scimIdentities).set({ active: false, lastSyncedAt: new Date() }).where(eq(scimIdentities.id, scimId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(
      eq(sessions.userId, current.user.id),
      isNull(sessions.revokedAt),
    ));
  });

  await recordAuditEvent({
    organizationId: auth.organizationId,
    actor: "SCIM token #" + auth.tokenId,
    action: "SCIM user deactivated",
    resource: current.user.email,
    metadata: { scimIdentityId: scimId, userId: current.user.id },
  });

  return new Response(null, { status: 204 });
}
