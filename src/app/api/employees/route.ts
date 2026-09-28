import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, employees } from "@/db/schema";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { seedProvisioning } from "@/lib/provisioning";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view the employee directory.",
  );
  if (denied) return denied;

  const rows = await db.select().from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(asc(employees.id));

  return Response.json(rows);
}

/**
 * Creates an employee and bootstraps Rippling-style onboarding: the standard
 * provisioning checklist is generated immediately so IT/HR tasks are tracked
 * from day one, and an optional asset is assigned in the same action.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const firstName = String(body.firstName ?? "").trim();
  const middleName = String(body.middleName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const title = String(body.title ?? "").trim();
  const basicRate = Number(body.basicRate);
  const startDate = String(body.startDate ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create employee records.",
  );
  if (denied) return denied;

  if (!firstName || !lastName || !Number.isFinite(basicRate) || basicRate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "firstName, lastName, a positive basicRate and YYYY-MM-DD startDate are required." }, { status: 400 });
  }

  const existingRows = await db.select({ id: employees.id }).from(employees).where(eq(employees.organizationId, organizationId));
  const existing = existingRows.length;
  const employeeNo = String(body.employeeNo ?? `EMP-${String(existing + 1).padStart(4, "0")}`).trim();

  const [created] = await db.insert(employees).values({
    organizationId,
    employeeNo,
    firstName,
    middleName: middleName || null,
    lastName,
    title: title || "Staff",
    employmentType: String(body.employmentType ?? "Regular"),
    status: "Active",
    avatarInitials: `${firstName[0] ?? "?"}${lastName[0] ?? "?"}`.toUpperCase(),
    basicRate: basicRate.toFixed(2),
    mwe: Boolean(body.mwe),
    region: String(body.region ?? "NCR"),
    email: email || null,
    mobile: String(body.mobile ?? "").trim() || null,
    tin: String(body.tin ?? "").trim() || null,
    sssNo: String(body.sssNo ?? "").trim() || null,
    philHealthNo: String(body.philHealthNo ?? "").trim() || null,
    pagIbigNo: String(body.pagIbigNo ?? "").trim() || null,
    nationality: String(body.nationality ?? "Filipino").trim() || "Filipino",
    startDate,
  }).returning();

  const onboarding = await seedProvisioning(organizationId, created.id, "onboarding");

  let assignedAsset = null;
  if (body.assetName) {
    const [asset] = await db.insert(assets).values({
      organizationId,
      employeeId: created.id,
      type: String(body.assetType ?? "Laptop"),
      name: String(body.assetName),
      serialNumber: body.serialNumber ? String(body.serialNumber) : null,
      status: "assigned",
      assignedOn: startDate,
    }).returning();
    assignedAsset = asset;
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee created with onboarding",
    resource: `${created.firstName} ${created.lastName} (${created.employeeNo})`,
    metadata: { employeeId: created.id, onboardingTasks: onboarding.length, asset: assignedAsset?.name ?? null },
  });

  return Response.json({ employee: created, onboarding, asset: assignedAsset }, { status: 201 });
}
