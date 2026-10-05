import { and, asc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  orgUnits,
  scheduleOverrides,
  worksites,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { worksiteAssignmentOverlaps } from "@/lib/workforce-worksite";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SITE_TYPES = new Set([
  "office",
  "branch",
  "plant",
  "hospital",
  "hotel",
  "store",
  "warehouse",
  "operations_site",
  "remote_hub",
]);

function cleanCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function scopedEmployee(userId: number, organizationId: number, employeeId: number) {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) {
    return { employee: null, denied: Response.json({ error: "Employee not found." }, { status: 404 }) };
  }
  const access = await getAccess(userId, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) {
    return {
      employee: null,
      denied: Response.json({ error: scope.error }, { status: scope.status }),
    };
  }
  return { employee, denied: null };
}

function worksiteVisibleToScope(
  worksite: { orgUnitId: number | null },
  access: Awaited<ReturnType<typeof getAccess>>,
) {
  if (!access) return false;
  return access.companyWide || worksite.orgUnitId == null || worksite.orgUnitId === access.orgUnitId;
}

async function scopedWorksite(
  userId: number,
  organizationId: number,
  worksiteId: number,
) {
  const [worksite] = await db.select().from(worksites).where(and(
    eq(worksites.id, worksiteId),
    eq(worksites.organizationId, organizationId),
  )).limit(1);
  if (!worksite) {
    return { worksite: null, denied: Response.json({ error: "Worksite not found." }, { status: 404 }) };
  }
  const access = await getAccess(userId, organizationId);
  if (!worksiteVisibleToScope(worksite, access)) {
    return {
      worksite: null,
      denied: Response.json({ error: "This worksite is outside your workforce scope." }, { status: 403 }),
    };
  }
  return { worksite, denied: null };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can review worksite assignments.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const [siteRows, employeeRows, assignmentRows] = await Promise.all([
    db.select().from(worksites)
      .where(eq(worksites.organizationId, organizationId))
      .orderBy(asc(worksites.name), asc(worksites.id)),
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(employeeWorksiteAssignments)
      .where(eq(employeeWorksiteAssignments.organizationId, organizationId))
      .orderBy(
        asc(employeeWorksiteAssignments.employeeId),
        asc(employeeWorksiteAssignments.effectiveFrom),
        asc(employeeWorksiteAssignments.id),
      ),
  ]);

  const visibleEmployees = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleEmployees.map((employee) => employee.id));
  const visibleWorksites = siteRows.filter((site) => worksiteVisibleToScope(site, access));
  const visibleWorksiteIds = new Set(visibleWorksites.map((site) => site.id));

  return Response.json({
    worksites: visibleWorksites,
    assignments: assignmentRows.filter((assignment) =>
      visibleEmployeeIds.has(assignment.employeeId)
      && visibleWorksiteIds.has(assignment.worksiteId),
    ),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    WORKFORCE_MANAGER_ROLES,
    "Only workforce managers can manage worksites.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-worksite-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "create_worksite") {
    if (!access.companyWide) {
      return Response.json({
        error: "Creating organization-wide worksite master data requires company-wide workforce access.",
      }, { status: 403 });
    }

    const code = cleanCode(body.code);
    const name = String(body.name ?? "").trim().slice(0, 160);
    const siteType = String(body.siteType ?? "office").trim();
    const timezone = String(body.timezone ?? "Asia/Manila").trim();
    const orgUnitId = body.orgUnitId == null || body.orgUnitId === ""
      ? null
      : Number(body.orgUnitId);
    const region = String(body.region ?? "").trim().slice(0, 64) || null;
    const province = String(body.province ?? "").trim().slice(0, 100) || null;
    const cityMunicipality = String(body.cityMunicipality ?? "").trim().slice(0, 120) || null;
    const addressLine1 = String(body.addressLine1 ?? "").trim().slice(0, 200) || null;

    if (
      !code
      || !name
      || !SITE_TYPES.has(siteType)
      || timezone !== "Asia/Manila"
      || (orgUnitId != null && !Number.isInteger(orgUnitId))
    ) {
      return Response.json({
        error: "code, name, a valid siteType, and Asia/Manila timezone are required.",
      }, { status: 400 });
    }

    if (orgUnitId != null) {
      const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
        eq(orgUnits.id, orgUnitId),
        eq(orgUnits.organizationId, organizationId),
      )).limit(1);
      if (!unit) return Response.json({ error: "Owning organization unit was not found." }, { status: 422 });
    }

    try {
      const [created] = await db.insert(worksites).values({
        organizationId,
        orgUnitId,
        code,
        name,
        siteType,
        timezone,
        region,
        province,
        cityMunicipality,
        addressLine1,
        active: true,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Worksite created",
        resource: `${created.code} · ${created.name}`,
        metadata: {
          worksiteId: created.id,
          orgUnitId,
          siteType,
          timezone,
          region,
          province,
          cityMunicipality,
        },
      });

      return Response.json({ worksite: created }, { status: 201 });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Worksite could not be created.",
      }, { status: 409 });
    }
  }

  if (action === "update_worksite") {
    if (!access.companyWide) {
      return Response.json({
        error: "Updating worksite master data requires company-wide workforce access.",
      }, { status: 403 });
    }

    const worksiteId = Number(body.worksiteId);
    if (!Number.isInteger(worksiteId)) {
      return Response.json({ error: "worksiteId is required." }, { status: 400 });
    }

    const worksiteCheck = await scopedWorksite(user.id, organizationId, worksiteId);
    if (worksiteCheck.denied) return worksiteCheck.denied;
    const existing = worksiteCheck.worksite!;

    const nextName = body.name == null ? existing.name : String(body.name).trim().slice(0, 160);
    const nextActive = body.active == null ? existing.active : Boolean(body.active);
    const nextRegion = body.region == null ? existing.region : String(body.region).trim().slice(0, 64) || null;
    const nextProvince = body.province == null ? existing.province : String(body.province).trim().slice(0, 100) || null;
    const nextCity = body.cityMunicipality == null
      ? existing.cityMunicipality
      : String(body.cityMunicipality).trim().slice(0, 120) || null;
    const nextAddress = body.addressLine1 == null
      ? existing.addressLine1
      : String(body.addressLine1).trim().slice(0, 200) || null;

    if (!nextName) return Response.json({ error: "Worksite name cannot be blank." }, { status: 400 });

    if (existing.active && !nextActive) {
      const today = new Date().toISOString().slice(0, 10);
      const [employeeUse, scheduleUse, overrideUse] = await Promise.all([
        db.select({ id: employeeWorksiteAssignments.id }).from(employeeWorksiteAssignments).where(and(
          eq(employeeWorksiteAssignments.organizationId, organizationId),
          eq(employeeWorksiteAssignments.worksiteId, worksiteId),
          or(
            isNull(employeeWorksiteAssignments.effectiveUntil),
            gte(employeeWorksiteAssignments.effectiveUntil, today),
          ),
        )).limit(1),
        db.select({ id: employeeScheduleAssignments.id }).from(employeeScheduleAssignments).where(and(
          eq(employeeScheduleAssignments.organizationId, organizationId),
          eq(employeeScheduleAssignments.worksiteId, worksiteId),
          or(
            isNull(employeeScheduleAssignments.effectiveUntil),
            gte(employeeScheduleAssignments.effectiveUntil, today),
          ),
        )).limit(1),
        db.select({ id: scheduleOverrides.id }).from(scheduleOverrides).where(and(
          eq(scheduleOverrides.organizationId, organizationId),
          eq(scheduleOverrides.worksiteId, worksiteId),
          gte(scheduleOverrides.workDate, today),
        )).limit(1),
      ]);
      if (employeeUse[0] || scheduleUse[0] || overrideUse[0]) {
        return Response.json({
          error: "This worksite still has current or future workforce assignments. Reassign those records before deactivating it.",
        }, { status: 409 });
      }
    }

    const [updated] = await db.update(worksites).set({
      name: nextName,
      active: nextActive,
      region: nextRegion,
      province: nextProvince,
      cityMunicipality: nextCity,
      addressLine1: nextAddress,
      updatedAt: new Date(),
    }).where(and(
      eq(worksites.id, worksiteId),
      eq(worksites.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Worksite updated",
      resource: `${updated.code} · ${updated.name}`,
      metadata: { worksiteId, active: nextActive },
    });

    return Response.json({ worksite: updated });
  }

  if (action === "assign_employee") {
    const employeeId = Number(body.employeeId);
    const worksiteId = Number(body.worksiteId);
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveUntil = String(body.effectiveUntil ?? "").trim() || null;
    const reason = String(body.reason ?? "Worksite assignment").trim().slice(0, 240);

    if (
      !Number.isInteger(employeeId)
      || !Number.isInteger(worksiteId)
      || !ISO_DATE.test(effectiveFrom)
      || (effectiveUntil && !ISO_DATE.test(effectiveUntil))
      || (effectiveUntil && effectiveUntil < effectiveFrom)
      || !reason
    ) {
      return Response.json({
        error: "employeeId, worksiteId, effectiveFrom, valid optional effectiveUntil, and reason are required.",
      }, { status: 400 });
    }

    const [employeeCheck, worksiteCheck] = await Promise.all([
      scopedEmployee(user.id, organizationId, employeeId),
      scopedWorksite(user.id, organizationId, worksiteId),
    ]);
    if (employeeCheck.denied) return employeeCheck.denied;
    if (worksiteCheck.denied) return worksiteCheck.denied;
    if (!worksiteCheck.worksite!.active) {
      return Response.json({ error: "Inactive worksites cannot receive new employee assignments." }, { status: 409 });
    }

    const existing = await db.select().from(employeeWorksiteAssignments).where(and(
      eq(employeeWorksiteAssignments.organizationId, organizationId),
      eq(employeeWorksiteAssignments.employeeId, employeeId),
    )).orderBy(
      asc(employeeWorksiteAssignments.effectiveFrom),
      asc(employeeWorksiteAssignments.id),
    );

    const openPrior = [...existing]
      .filter((row) =>
        !row.effectiveUntil
        && String(row.effectiveFrom) < effectiveFrom,
      )
      .sort((a, b) =>
        String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)) || b.id - a.id,
      )[0] ?? null;

    const adjustedExisting = existing.map((row) =>
      openPrior?.id === row.id
        ? { ...row, effectiveUntil: addDays(effectiveFrom, -1) }
        : row,
    );

    if (worksiteAssignmentOverlaps(
      adjustedExisting.map((row) => ({
        id: row.id,
        worksiteId: row.worksiteId,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      })),
      { effectiveFrom, effectiveUntil },
    )) {
      return Response.json({
        error: "This employee already has another worksite assignment overlapping the requested effective dates.",
      }, { status: 409 });
    }

    const result = await db.transaction(async (tx) => {
      if (openPrior) {
        await tx.update(employeeWorksiteAssignments).set({
          effectiveUntil: addDays(effectiveFrom, -1),
        }).where(eq(employeeWorksiteAssignments.id, openPrior.id));
      }

      const [created] = await tx.insert(employeeWorksiteAssignments).values({
        organizationId,
        employeeId,
        worksiteId,
        effectiveFrom,
        effectiveUntil,
        reason,
        createdBy: user.name,
      }).returning();
      return created;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee worksite assigned",
      resource: `${employeeCheck.employee!.employeeNo} · ${worksiteCheck.worksite!.code}`,
      metadata: {
        employeeWorksiteAssignmentId: result.id,
        employeeId,
        worksiteId,
        effectiveFrom,
        effectiveUntil,
        closedPriorAssignmentId: openPrior?.id ?? null,
        reason,
      },
    });

    return Response.json({ assignment: result }, { status: 201 });
  }

  return Response.json({
    error: "Unsupported action. Use create_worksite, update_worksite, or assign_employee.",
  }, { status: 400 });
}
