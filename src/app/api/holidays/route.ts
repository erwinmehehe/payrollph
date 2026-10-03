import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, holidays, orgUnits, payrollEntries, payrollRuns } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOLIDAY_KINDS = new Set(["regular", "special"]);

const BUSY_PAYROLL_STATUSES = new Set(["Queued", "Processing", "Recalculating", "Releasing"]);

async function affectedPayrollRuns(organizationId: number, dates: string[]) {
  const rows = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId));
  return rows.filter((run) =>
    dates.some((date) => String(run.periodStart) <= date && String(run.periodEnd) >= date)
  );
}

async function assertHolidayMutationNotRacingPayroll(organizationId: number, dates: string[]) {
  const affected = await affectedPayrollRuns(organizationId, dates);
  const busy = affected.filter((run) => BUSY_PAYROLL_STATUSES.has(run.status));
  if (busy.length > 0) {
    throw new Error(
      `Holiday calendar cannot change while overlapping payroll is processing or releasing (run #${busy[0].id}, ${busy[0].status}). Retry after that payroll action finishes.`,
    );
  }
  return affected;
}

async function invalidateAffectedPayroll(
  organizationId: number,
  affected: Awaited<ReturnType<typeof affectedPayrollRuns>>,
) {
  const stale = affected.filter((run) =>
    run.status !== "Released" && !BUSY_PAYROLL_STATUSES.has(run.status)
  );
  if (stale.length === 0) return [] as number[];

  const tasks = await db.select().from(approvalTasks)
    .where(eq(approvalTasks.organizationId, organizationId));
  const invalidated: number[] = [];

  await db.transaction(async (tx) => {
    for (const run of stale) {
      await tx.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      const [updated] = await tx.update(payrollRuns).set({
        status: "Draft",
        employeeCount: 0,
        grossPay: "0",
        netPay: "0",
        exceptions: 0,
        processedChunks: 0,
        totalChunks: 0,
      }).where(and(
        eq(payrollRuns.id, run.id),
        eq(payrollRuns.status, run.status),
      )).returning({ id: payrollRuns.id });
      if (!updated) {
        throw new Error(
          `Payroll run #${run.id} changed state while the holiday calendar was being updated. No holiday change was applied; retry after payroll activity finishes.`,
        );
      }
      invalidated.push(updated.id);

      for (const task of tasks) {
        if (!task.detail.includes(`Payroll run #${run.id}`)) continue;
        if (task.status !== "Pending" && task.status !== "Approved") continue;
        await tx.update(approvalTasks).set({
          status: "Superseded",
          decidedBy: "System",
          decidedAt: new Date(),
        }).where(eq(approvalTasks.id, task.id));
      }
    }
  });

  return invalidated;
}

async function validateOrgUnit(organizationId: number, value: unknown) {
  if (value == null || value === "") return null;
  const orgUnitId = Number(value);
  if (!Number.isInteger(orgUnitId) || orgUnitId <= 0) throw new Error("Invalid organization unit.");
  const [unit] = await db.select().from(orgUnits).where(and(
    eq(orgUnits.id, orgUnitId),
    eq(orgUnits.organizationId, organizationId),
  )).limit(1);
  if (!unit) throw new Error("The selected organization unit does not belong to this organization.");
  return unit.id;
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People/payroll users can review the holiday calendar.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [organizationRows, unitRows] = await Promise.all([
    db.select().from(holidays).where(
      eq(holidays.organizationId, organizationId),
    ).orderBy(asc(holidays.holidayDate), asc(holidays.id)),
    db.select().from(orgUnits).where(eq(orgUnits.organizationId, organizationId)),
  ]);

  const unitById = new Map(unitRows.map((unit) => [unit.id, unit]));
  const visibleScopeIds = new Set<number>();
  let scopeCursor = access.orgUnitId;
  let scopeGuard = 0;
  while (scopeCursor != null && scopeGuard < 50) {
    if (visibleScopeIds.has(scopeCursor)) break;
    visibleScopeIds.add(scopeCursor);
    scopeCursor = unitById.get(scopeCursor)?.parentId ?? null;
    scopeGuard += 1;
  }

  const visible = access.companyWide
    ? organizationRows
    : organizationRows.filter(
        (row) => row.orgUnitId == null || visibleScopeIds.has(row.orgUnitId),
      );

  return Response.json({
    holidays: visible,
    note: "National statutory holidays are maintained separately by the payroll ruleset; these rows are organization/local declarations.",
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const holidayDate = String(body.holidayDate ?? "").trim();
  const name = String(body.name ?? "").trim().slice(0, 120);
  const kind = String(body.kind ?? "").trim().toLowerCase();

  if (
    !Number.isInteger(organizationId)
    || !ISO_DATE.test(holidayDate)
    || !name
    || !HOLIDAY_KINDS.has(kind)
  ) {
    return Response.json({
      error: "organizationId, holidayDate (YYYY-MM-DD), name, and kind (regular/special) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People/payroll users can manage the holiday calendar.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Holiday declarations require company-wide payroll access.",
    }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "holiday-calendar-create",
    resourceId: organizationId,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let orgUnitId: number | null;
  let affectedRuns: Awaited<ReturnType<typeof affectedPayrollRuns>>;
  try {
    orgUnitId = await validateOrgUnit(organizationId, body.orgUnitId);
    affectedRuns = await assertHolidayMutationNotRacingPayroll(organizationId, [holidayDate]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid holiday change.";
    const conflict = message.startsWith("Holiday calendar cannot change");
    return Response.json({
      error: message,
      ...(conflict ? { code: "HOLIDAY_PAYROLL_BUSY" } : {}),
    }, { status: conflict ? 409 : 422 });
  }

  let invalidatedPayrollRunIds: number[];
  try {
    invalidatedPayrollRunIds = await invalidateAffectedPayroll(organizationId, affectedRuns!);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll state changed during holiday update.",
      code: "HOLIDAY_PAYROLL_BUSY",
    }, { status: 409 });
  }

  const [row] = await db.insert(holidays).values({
    organizationId,
    orgUnitId,
    holidayDate,
    name,
    kind,
  }).returning();
  const releasedPayrollRunIdsRequiringRetroReview = affectedRuns!
    .filter((run) => run.status === "Released")
    .map((run) => run.id);

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Payroll holiday declared",
    resource: `${holidayDate} · ${name}`,
    metadata: {
      holidayId: row.id,
      holidayDate,
      kind,
      orgUnitId,
      invalidatedPayrollRunIds,
      releasedPayrollRunIdsRequiringRetroReview,
    },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [existing] = await db.select().from(holidays).where(eq(holidays.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Holiday not found." }, { status: 404 });
  if (existing.organizationId == null) {
    return Response.json({ error: "System/national holiday rows are read-only." }, { status: 409 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    existing.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People/payroll users can manage the holiday calendar.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, existing.organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Holiday declarations require company-wide payroll access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "holiday-calendar-update",
    resourceId: id,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const holidayDate = body.holidayDate === undefined
    ? String(existing.holidayDate)
    : String(body.holidayDate ?? "").trim();
  const name = body.name === undefined ? existing.name : String(body.name ?? "").trim().slice(0, 120);
  const kind = body.kind === undefined ? existing.kind : String(body.kind ?? "").trim().toLowerCase();

  if (!ISO_DATE.test(holidayDate) || !name || !HOLIDAY_KINDS.has(kind)) {
    return Response.json({ error: "Holiday date/name/kind are invalid." }, { status: 422 });
  }

  let orgUnitId = existing.orgUnitId;
  if (body.orgUnitId !== undefined) {
    try {
      orgUnitId = await validateOrgUnit(existing.organizationId, body.orgUnitId);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Invalid organization unit." }, { status: 422 });
    }
  }

  let affectedRuns: Awaited<ReturnType<typeof affectedPayrollRuns>>;
  const affectedDates = [...new Set([String(existing.holidayDate), holidayDate])];
  try {
    affectedRuns = await assertHolidayMutationNotRacingPayroll(existing.organizationId, affectedDates);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Holiday change conflicts with active payroll.",
      code: "HOLIDAY_PAYROLL_BUSY",
    }, { status: 409 });
  }

  let invalidatedPayrollRunIds: number[];
  try {
    invalidatedPayrollRunIds = await invalidateAffectedPayroll(existing.organizationId, affectedRuns!);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll state changed during holiday update.",
      code: "HOLIDAY_PAYROLL_BUSY",
    }, { status: 409 });
  }

  const [row] = await db.update(holidays).set({
    holidayDate,
    name,
    kind,
    orgUnitId,
  }).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  )).returning();
  const releasedPayrollRunIdsRequiringRetroReview = affectedRuns!
    .filter((run) => run.status === "Released")
    .map((run) => run.id);

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: session.name,
    action: "Payroll holiday updated",
    resource: `${holidayDate} · ${name}`,
    metadata: {
      holidayId: id,
      before: {
        holidayDate: existing.holidayDate,
        name: existing.name,
        kind: existing.kind,
        orgUnitId: existing.orgUnitId,
      },
      after: { holidayDate, name, kind, orgUnitId },
      invalidatedPayrollRunIds,
      releasedPayrollRunIdsRequiringRetroReview,
    },
  });

  return Response.json(row);
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [existing] = await db.select().from(holidays).where(eq(holidays.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Holiday not found." }, { status: 404 });
  if (existing.organizationId == null) {
    return Response.json({ error: "System/national holiday rows are read-only." }, { status: 409 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    existing.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People/payroll users can manage the holiday calendar.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, existing.organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Holiday declarations require company-wide payroll access." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "holiday-calendar-delete",
    resourceId: id,
    limit: 8,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let affectedRuns: Awaited<ReturnType<typeof affectedPayrollRuns>>;
  try {
    affectedRuns = await assertHolidayMutationNotRacingPayroll(
      existing.organizationId,
      [String(existing.holidayDate)],
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Holiday change conflicts with active payroll.",
      code: "HOLIDAY_PAYROLL_BUSY",
    }, { status: 409 });
  }

  let invalidatedPayrollRunIds: number[];
  try {
    invalidatedPayrollRunIds = await invalidateAffectedPayroll(existing.organizationId, affectedRuns!);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll state changed during holiday update.",
      code: "HOLIDAY_PAYROLL_BUSY",
    }, { status: 409 });
  }

  await db.delete(holidays).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  ));
  const releasedPayrollRunIdsRequiringRetroReview = affectedRuns!
    .filter((run) => run.status === "Released")
    .map((run) => run.id);

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: session.name,
    action: "Payroll holiday removed",
    resource: `${existing.holidayDate} · ${existing.name}`,
    metadata: {
      holidayId: id,
      orgUnitId: existing.orgUnitId,
      kind: existing.kind,
      invalidatedPayrollRunIds,
      releasedPayrollRunIdsRequiringRetroReview,
    },
  });

  return Response.json({ ok: true });
}
