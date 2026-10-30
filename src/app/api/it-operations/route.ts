
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, auditEvents, employees, itAccessGrants, itApplications, itDeviceEvents, itManagedDevices, provisioningTasks } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, requireSensitiveActionMfa, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";
const valid = (x: unknown) => Number.isSafeInteger(Number(x)) && Number(x) > 0;
async function context(userId: number, org: number) {
  const denied = await assertOrganizationRole(userId, org, PEOPLE_ADMIN_ROLES);
  if (denied) return { denied };
  const access = await getAccess(userId, org);
  if (!access) return { denied: Response.json({ error: "Access denied." }, { status: 403 }) };
  return { access };
}
async function checkEmployee(org: number, employeeId: number, access: NonNullable<Awaited<ReturnType<typeof getAccess>>>) {
  const [e] = await db.select().from(employees).where(and(eq(employees.organizationId, org), eq(employees.id, employeeId))).limit(1);
  if (!e) return { error: Response.json({ error: "Employee not found." }, { status: 404 }) };
  const scope = assertScope(access, e.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { employee: e };
}
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const org = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!valid(org)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const auth = await context(user.id, org);
  if (auth.denied) return auth.denied;
  const [staff, inventory, devices, apps, grants, tasks] = await Promise.all([
    db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, orgUnitId: employees.orgUnitId, status: employees.status }).from(employees).where(eq(employees.organizationId, org)),
    db.select().from(assets).where(eq(assets.organizationId, org)),
    db.select().from(itManagedDevices).where(eq(itManagedDevices.organizationId, org)),
    db.select().from(itApplications).where(eq(itApplications.organizationId, org)),
    db.select().from(itAccessGrants).where(eq(itAccessGrants.organizationId, org)),
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, org)),
  ]);
  const visible = new Set(staff.filter(e => auth.access!.companyWide || e.orgUnitId === auth.access!.orgUnitId).map(e => e.id));
  const visibleDevices = devices.filter(d => d.employeeId != null ? visible.has(d.employeeId) : auth.access!.companyWide);
  return Response.json({
    employees: staff.filter(e => visible.has(e.id)),
    assets: inventory.filter(a => a.employeeId != null ? visible.has(a.employeeId) : auth.access!.companyWide),
    devices: visibleDevices,
    applications: apps,
    grants: grants.filter(g => visible.has(g.employeeId)),
    tasks: tasks.filter(t => visible.has(t.employeeId) && t.owner === "IT"),
  });
}
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const org = Number(body.organizationId);
  if (!valid(org)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const auth = await context(user.id, org);
  if (auth.denied) return auth.denied;
  const access = auth.access!;
  if (body.action === "application") {
    if (!access.companyWide) return Response.json({ error: "Only company-wide admins can add applications." }, { status: 403 });
    const name = String(body.name ?? "").trim();
    if (name.length < 2 || name.length > 120) return Response.json({ error: "Application name must be 2-120 characters." }, { status: 422 });
    const [created] = await db.insert(itApplications).values({ organizationId: org, name }).onConflictDoNothing().returning();
    if (!created) return Response.json({ error: "Application already exists." }, { status: 409 });
    await recordAuditEvent({ organizationId: org, actor: user.name, action: "IT application registered", resource: name });
    return Response.json(created, { status: 201 });
  }
  if (body.action === "grant") {
    const employeeId = Number(body.employeeId), applicationId = Number(body.applicationId);
    if (!valid(employeeId) || !valid(applicationId)) return Response.json({ error: "Employee and app required." }, { status: 422 });
    const employeeCheck = await checkEmployee(org, employeeId, access);
    if (employeeCheck.error) return employeeCheck.error;
    if (employeeCheck.employee!.status !== "Active") return Response.json({ error: "Only active employees can receive new app access." }, { status: 409 });
    const [app] = await db.select().from(itApplications).where(and(eq(itApplications.organizationId, org), eq(itApplications.id, applicationId))).limit(1);
    if (!app) return Response.json({ error: "Application not found." }, { status: 404 });
    const created = await db.transaction(async tx => {
      // Serialize grants with HR separation, which updates/locks this worker.
      await tx.execute(sql`select id from employees where organization_id = ${org} and id = ${employeeId} for update`);
      const [current] = await tx.select({ status: employees.status }).from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.organizationId, org))).limit(1);
      if (current?.status !== "Active") throw new Error("Only active employees can receive new app access.");
      const [row] = await tx.insert(itAccessGrants).values({ organizationId: org, employeeId, applicationId, requestedByUserId: user.id })
        .onConflictDoNothing().returning();
      if (!row) throw new Error("Existing access record; use lifecycle action.");
      await tx.insert(auditEvents).values({ organizationId: org, actor: user.name, action: "IT access requested", resource: app.name, metadata: { employeeId, applicationId } });
      return row;
    }).catch(e => e instanceof Error ? e : new Error("Could not request access."));
    if (created instanceof Error) return Response.json({ error: created.message }, { status: 409 });
    return Response.json(created, { status: 201 });
  }
  if (body.action === "device") {
    const assetId = Number(body.assetId);
    if (!valid(assetId)) return Response.json({ error: "Asset id required." }, { status: 422 });
    const [asset] = await db.select().from(assets).where(and(eq(assets.organizationId, org), eq(assets.id, assetId))).limit(1);
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    let currentEmployeeStatus: string | null = null;
    if (asset.employeeId != null) {
      const check = await checkEmployee(org, asset.employeeId, access);
      if (check.error) return check.error;
      currentEmployeeStatus = check.employee!.status;
    } else if (!access.companyWide) return Response.json({ error: "Unassigned device outside unit scope." }, { status: 403 });
    const [device] = await db.insert(itManagedDevices).values({
      organizationId: org, assetId, employeeId: asset.employeeId,
      state: asset.employeeId == null ? "available" : currentEmployeeStatus === "Active" ? "assigned" : "return_requested",
      mdmProvider: String(body.mdmProvider ?? "").trim().slice(0, 100) || null,
      mdmReference: String(body.mdmReference ?? "").trim().slice(0, 160) || null,
    }).onConflictDoNothing().returning();
    if (!device) return Response.json({ error: "Asset already tracked as a device." }, { status: 409 });
    await db.insert(itDeviceEvents).values({ organizationId: org, deviceId: device.id, employeeId: device.employeeId, actorUserId: user.id, eventType: "device_registered" });
    await recordAuditEvent({ organizationId: org, actor: user.name, action: "IT device registered", resource: String(assetId), metadata: { deviceId: device.id } });
    return Response.json(device, { status: 201 });
  }
  return Response.json({ error: "Unknown action." }, { status: 422 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const org = Number(body.organizationId);
  if (!valid(id) || !valid(org)) {
    return Response.json({ error: "Valid id and organizationId required." }, { status: 422 });
  }
  // Authorize the caller-selected tenant BEFORE querying any resource ID.
  // Otherwise an existing foreign ID returns 403 while a nonexistent ID returns
  // 404, leaking the existence of another employer's grant or device.
  const auth = await context(user.id, org);
  if (auth.denied) return auth.denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "it-custody-access-decision",
    resourceId: org + ":" + id, limit: 20, windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;
  if (body.action === "access") {
    const [grant] = await db.select().from(itAccessGrants).where(and(
      eq(itAccessGrants.id, id),
      eq(itAccessGrants.organizationId, org),
    )).limit(1);
    if (!grant) return Response.json({ error: "Access record not found." }, { status: 404 });
    const employeeCheck = await checkEmployee(grant.organizationId, grant.employeeId, auth.access!);
    if (employeeCheck.error) return employeeCheck.error;
    const next = String(body.state);
    const allowed: Record<string, string[]> = { grant_requested: ["active", "revoked"], active: ["revoke_requested"], revoke_requested: ["revoked"], revoked: [] };
    if (!allowed[grant.state]?.includes(next)) return Response.json({ error: "Invalid access transition." }, { status: 409 });
    if (next === "active" && employeeCheck.employee!.status !== "Active") return Response.json({ error: "Cannot grant access to a separating or separated employee." }, { status: 409 });
    const updated = await db.transaction(async tx => {
      await tx.execute(sql`select id from employees where organization_id = ${grant.organizationId} and id = ${grant.employeeId} for update`);
      const [worker] = await tx.select({ status: employees.status }).from(employees)
        .where(and(eq(employees.organizationId, grant.organizationId), eq(employees.id, grant.employeeId))).limit(1);
      if (next === "active" && worker?.status !== "Active") throw new Error("Employee is no longer active; confirm revocation instead.");
      const [row] = await tx.update(itAccessGrants).set({ state: next, confirmedByUserId: user.id, updatedAt: new Date() })
        .where(and(eq(itAccessGrants.id, id), eq(itAccessGrants.organizationId, grant.organizationId), eq(itAccessGrants.state, grant.state))).returning();
      if (!row) throw new Error("Access record changed; refresh.");
      await tx.insert(auditEvents).values({
        organizationId: grant.organizationId, actor: user.name,
        action: "IT app access " + next + " (manually confirmed)", resource: String(id),
        metadata: { employeeId: grant.employeeId, applicationId: grant.applicationId, actorUserId: user.id },
      });
      return row;
    }).catch(e => e instanceof Error ? e : new Error("Access decision failed."));
    if (updated instanceof Error) return Response.json({ error: updated.message }, { status: 409 });
    return Response.json(updated);
  }
  if (body.action === "device") {
    const [device] = await db.select().from(itManagedDevices).where(and(
      eq(itManagedDevices.id, id),
      eq(itManagedDevices.organizationId, org),
    )).limit(1);
    if (!device) return Response.json({ error: "Device not found." }, { status: 404 });
    const access = auth.access!;
    if (device.employeeId != null) { const check = await checkEmployee(device.organizationId, device.employeeId, access); if (check.error) return check.error; }
    else if (!access.companyWide) return Response.json({ error: "Company inventory outside unit scope." }, { status: 403 });
    const next = String(body.state ?? "");
    const transitions: Record<string, string[]> = { available: ["assigned", "retired"], assigned: ["return_requested", "lost"], return_requested: ["returned", "lost"], returned: ["available", "retired"], lost: ["returned"], retired: [] };
    if (!transitions[device.state]?.includes(next)) return Response.json({ error: "Invalid device transition." }, { status: 409 });
    let employeeId: number | null = device.employeeId;
    if (next === "assigned") {
      employeeId = Number(body.employeeId);
      if (!valid(employeeId)) return Response.json({ error: "Employee required for assignment." }, { status: 422 });
      const check = await checkEmployee(device.organizationId, employeeId, access);
      if (check.error) return check.error;
      if (check.employee!.status !== "Active") return Response.json({ error: "Employee must be active." }, { status: 409 });
    }
    const priorCustodianId = device.employeeId;
    if (next === "returned" || next === "available" || next === "retired") employeeId = null;
    const result = await db.transaction(async tx => {
      if (next === "assigned" && employeeId != null) {
        await tx.execute(sql`select id from employees where organization_id = ${device.organizationId} and id = ${employeeId} for update`);
        const [worker] = await tx.select({ status: employees.status }).from(employees)
          .where(and(eq(employees.organizationId, device.organizationId), eq(employees.id, employeeId))).limit(1);
        if (worker?.status !== "Active") throw new Error("Employee is no longer active; device cannot be assigned.");
      }
      const [row] = await tx.update(itManagedDevices).set({ state: next, employeeId, updatedAt: new Date() })
        .where(and(eq(itManagedDevices.id, id), eq(itManagedDevices.organizationId, device.organizationId), eq(itManagedDevices.state, device.state))).returning();
      if (!row) throw new Error("Device changed; refresh.");
      await tx.update(assets).set({
        employeeId,
        status: ["returned", "available", "retired"].includes(next) ? "returned" : next === "lost" ? "maintenance" : "assigned",
        assignedOn: next === "assigned" ? new Date().toISOString().slice(0, 10) : undefined,
        returnedOn: next === "returned" ? new Date().toISOString().slice(0, 10) : undefined,
      }).where(and(eq(assets.id, device.assetId), eq(assets.organizationId, device.organizationId)));
      await tx.insert(itDeviceEvents).values({ organizationId: device.organizationId, deviceId: id, eventType: next, employeeId: next === "returned" ? priorCustodianId : employeeId, actorUserId: user.id });
      await tx.insert(auditEvents).values({
        organizationId: device.organizationId, actor: user.name, action: "IT device " + next,
        resource: String(device.assetId), metadata: { deviceId: id, employeeId, priorCustodianId, actorUserId: user.id },
      });
      return row;
    }).catch(e => e instanceof Error ? e : new Error("Device transition failed."));
    if (result instanceof Error) return Response.json({ error: result.message }, { status: 409 });
    return Response.json(result);
  }
  return Response.json({ error: "Unknown action." }, { status: 422 });
}
