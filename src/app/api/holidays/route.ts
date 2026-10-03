import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { holidays, orgUnits } from "@/db/schema";
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
  try {
    orgUnitId = await validateOrgUnit(organizationId, body.orgUnitId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid organization unit." }, { status: 422 });
  }

  const [row] = await db.insert(holidays).values({
    organizationId,
    orgUnitId,
    holidayDate,
    name,
    kind,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Payroll holiday declared",
    resource: `${holidayDate} · ${name}`,
    metadata: { holidayId: row.id, holidayDate, kind, orgUnitId },
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

  const [row] = await db.update(holidays).set({
    holidayDate,
    name,
    kind,
    orgUnitId,
  }).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  )).returning();

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

  await db.delete(holidays).where(and(
    eq(holidays.id, id),
    eq(holidays.organizationId, existing.organizationId),
  ));

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: session.name,
    action: "Payroll holiday removed",
    resource: `${existing.holidayDate} · ${existing.name}`,
    metadata: { holidayId: id, orgUnitId: existing.orgUnitId, kind: existing.kind },
  });

  return Response.json({ ok: true });
}
