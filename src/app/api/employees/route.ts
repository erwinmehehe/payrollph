import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, employeePayProfiles, employees } from "@/db/schema";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { seedProvisioning } from "@/lib/provisioning";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { resolvePayProfile } from "@/lib/pay-basis";

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

  await ensureEmployeePayProfiles(organizationId);
  const [rows, payProfiles] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, organizationId)),
  ]);
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));

  return Response.json(rows.map((employee) => {
    const profile = payByEmployee.get(employee.id);
    return {
      ...employee,
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? employee.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
    };
  }));
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
  const rateAmount = Number(body.rateAmount ?? body.basicRate);
  const startDate = String(body.startDate ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create employee records.",
  );
  if (denied) return denied;

  let payProfile;
  try {
    payProfile = resolvePayProfile({
      payBasis: String(body.payBasis ?? "monthly"),
      rateAmount,
      standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? 22),
      standardHoursPerDay: Number(body.standardHoursPerDay ?? 8),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pay profile is invalid." }, { status: 400 });
  }

  if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "firstName, lastName and YYYY-MM-DD startDate are required." }, { status: 400 });
  }

  await ensureEmployeePayProfiles(organizationId);

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
    basicRate: payProfile.monthlyEquivalent.toFixed(2),
    mwe: Boolean(body.mwe),
    region: String(body.region ?? "NCR"),
    email: email || null,
    mobile: String(body.mobile ?? "").trim() || null,
    tin: String(body.tin ?? "").trim() || null,
    tinBranchCode: String(body.tinBranchCode ?? "").replace(/\D/g, "").padStart(4, "0").slice(-4) || null,
    sssNo: String(body.sssNo ?? "").trim() || null,
    philHealthNo: String(body.philHealthNo ?? "").trim() || null,
    pagIbigNo: String(body.pagIbigNo ?? "").trim() || null,
    nationality: String(body.nationality ?? "Filipino").trim() || "Filipino",
    startDate,
  }).returning();

  await db.insert(employeePayProfiles).values({
    employeeId: created.id,
    organizationId,
    payBasis: payProfile.payBasis,
    rateAmount: payProfile.rateAmount.toFixed(2),
    standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
    standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
  }).onConflictDoUpdate({
    target: employeePayProfiles.employeeId,
    set: {
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
      updatedAt: new Date(),
    },
  });

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
    metadata: {
      employeeId: created.id,
      onboardingTasks: onboarding.length,
      asset: assignedAsset?.name ?? null,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount,
      monthlyEquivalent: payProfile.monthlyEquivalent,
    },
  });

  return Response.json({ employee: created, onboarding, asset: assignedAsset }, { status: 201 });
}


/**
 * Updates government identity fields for an existing employee. These values are
 * deliberately editable after onboarding because real employer records are
 * often completed after the employee account itself is created.
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);

  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can update government identity records.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    ))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  await ensureEmployeePayProfiles(organizationId);
  const [existingPayProfile] = await db.select().from(employeePayProfiles)
    .where(eq(employeePayProfiles.employeeId, employeeId))
    .limit(1);

  const clean = (value: unknown) => {
    if (value === undefined) return undefined;
    const text = String(value ?? "").trim();
    return text || null;
  };

  const wantsPayUpdate = [
    body.payBasis,
    body.rateAmount,
    body.basicRate,
    body.standardWorkDaysPerMonth,
    body.standardHoursPerDay,
  ].some((value) => value !== undefined);

  let nextPayProfile = null;
  if (wantsPayUpdate) {
    try {
      nextPayProfile = resolvePayProfile({
        payBasis: String(body.payBasis ?? existingPayProfile?.payBasis ?? "monthly"),
        rateAmount: Number(body.rateAmount ?? body.basicRate ?? existingPayProfile?.rateAmount ?? employee.basicRate),
        standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? existingPayProfile?.standardWorkDaysPerMonth ?? 22),
        standardHoursPerDay: Number(body.standardHoursPerDay ?? existingPayProfile?.standardHoursPerDay ?? 8),
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Pay profile is invalid." }, { status: 400 });
    }
  }

  const updates = {
    middleName: clean(body.middleName),
    tin: clean(body.tin),
    tinBranchCode: body.tinBranchCode === undefined
      ? undefined
      : String(body.tinBranchCode ?? "").replace(/\D/g, "").padStart(4, "0").slice(-4) || null,
    sssNo: clean(body.sssNo),
    philHealthNo: clean(body.philHealthNo),
    pagIbigNo: clean(body.pagIbigNo),
    nationality: body.nationality === undefined ? undefined : String(body.nationality ?? "").trim() || "Filipino",
  };

  const patch = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  ) as Partial<typeof employees.$inferInsert>;

  if (Object.keys(patch).length === 0 && !nextPayProfile) {
    return Response.json({ error: "No employee profile fields were supplied." }, { status: 400 });
  }

  if (nextPayProfile) {
    patch.basicRate = nextPayProfile.monthlyEquivalent.toFixed(2);
  }

  const [updated] = await db.update(employees)
    .set(patch)
    .where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    ))
    .returning();

  if (nextPayProfile) {
    await db.insert(employeePayProfiles).values({
      employeeId,
      organizationId,
      payBasis: nextPayProfile.payBasis,
      rateAmount: nextPayProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
    }).onConflictDoUpdate({
      target: employeePayProfiles.employeeId,
      set: {
        payBasis: nextPayProfile.payBasis,
        rateAmount: nextPayProfile.rateAmount.toFixed(2),
        standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
        standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
        updatedAt: new Date(),
      },
    });
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: nextPayProfile ? "Employee payroll profile updated" : "Employee government identity updated",
    resource: `${employee.firstName} ${employee.lastName} (${employee.employeeNo})`,
    metadata: {
      employeeId,
      fields: [...Object.keys(patch), ...(nextPayProfile ? ["payBasis", "rateAmount", "standardWorkDaysPerMonth", "standardHoursPerDay"] : [])],
      payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
    },
  });

  return Response.json({
    employee: {
      ...updated,
      payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
      payRate: (nextPayProfile?.rateAmount ?? Number(existingPayProfile?.rateAmount ?? updated.basicRate)).toFixed(2),
      standardWorkDaysPerMonth: (nextPayProfile?.standardWorkDaysPerMonth ?? Number(existingPayProfile?.standardWorkDaysPerMonth ?? 22)).toFixed(2),
      standardHoursPerDay: (nextPayProfile?.standardHoursPerDay ?? Number(existingPayProfile?.standardHoursPerDay ?? 8)).toFixed(2),
    },
  });
}
