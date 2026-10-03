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
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

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
      }).where(eq(payrollRuns.id, run.id)).returning({ id: payrollRuns.id });
      if (updated) invalidated.push(updated.id);

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

  const organizationRows = await db.select().from(holidays).where(
    eq(holidays.organizationId, organizationId),
  ).orderBy(asc(holidays.holidayDate), asc(holidays.id));

  const visible = access.companyWide
    ? organizationRows
    : organizationRows.filter((row) => row.orgUnitId == null || row.orgUnitId === access.orgUnitId);

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

  const [row] = await db.insert(holidays).values({
    organizationId,
    orgUnitId,
    holidayDate,
    name,
    kind,
  }).returning();

  const invalidatedPayrollRunIds = await invalidateAffectedPayroll(organizationId, affectedRuns!);

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Payroll holiday declared",
    resource: `${holidayDate} · ${name}`,
    metadata: { holidayId: row.id, holidayDate, kind, orgUnitId, invalidatedPayrollRunIds },
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

  const [row] = await db.update(holidays).set({
    holidayDate,
    name,
    kind,
    orgUnitId,
  }).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  )).returning();

  const invalidatedPayrollRunIds = await invalidateAffectedPayroll(existing.organizationId, affectedRuns!);

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

  await db.delete(holidays).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  ));

  const invalidatedPayrollRunIds = await invalidateAffectedPayroll(existing.organizationId, affectedRuns!);

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
    },
  });

  return Response.json({ ok: true });
}
