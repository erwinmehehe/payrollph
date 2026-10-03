import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, supplementaryEarnings } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const EARNING_TYPES = new Set([
  "commission",
  "bonus",
  "honorarium",
  "taxable_allowance",
  "other_taxable",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can review supplementary earnings.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const employeeRows = await db.select({
    id: employees.id,
    orgUnitId: employees.orgUnitId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  }).from(employees).where(eq(employees.organizationId, organizationId));
  const visible = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = visible.map((employee) => employee.id);
  if (visibleIds.length === 0) return Response.json({ earnings: [] });

  const rows = await db.select().from(supplementaryEarnings).where(and(
    eq(supplementaryEarnings.organizationId, organizationId),
    inArray(supplementaryEarnings.employeeId, visibleIds),
  )).orderBy(asc(supplementaryEarnings.effectiveDate), asc(supplementaryEarnings.id));

  const employeeById = new Map(visible.map((employee) => [employee.id, employee]));
  return Response.json({
    earnings: rows.map((row) => {
      const employee = employeeById.get(row.employeeId);
      return {
        ...row,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
        employeeNo: employee?.employeeNo ?? null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const earningType = String(body.earningType ?? "").trim().toLowerCase();
  const label = String(body.label ?? "").trim().slice(0, 120);
  const amount = Number(body.amount);
  const effectiveDate = String(body.effectiveDate ?? "").trim();
  const legacyStatutoryBase = body.includeInStatutoryBase;
  const includeInSssBase = body.includeInSssBase === undefined
    ? legacyStatutoryBase !== false
    : body.includeInSssBase !== false;
  const includeInPagIbigBase = body.includeInPagIbigBase === undefined
    ? legacyStatutoryBase !== false
    : body.includeInPagIbigBase !== false;

  if (
    !Number.isInteger(organizationId)
    || !Number.isInteger(employeeId)
    || !EARNING_TYPES.has(earningType)
    || !label
    || !Number.isFinite(amount)
    || amount <= 0
    || !ISO_DATE.test(effectiveDate)
  ) {
    return Response.json({
      error: "organizationId, employeeId, earningType, label, positive amount, and effectiveDate (YYYY-MM-DD) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can add taxable supplementary earnings.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });

  const access = await getAccess(session.id, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const [row] = await db.insert(supplementaryEarnings).values({
    organizationId,
    employeeId,
    earningType,
    label,
    amount: amount.toFixed(2),
    taxable: true,
    includeInSssBase,
    includeInPagIbigBase,
    effectiveDate,
    status: "approved",
    createdBy: session.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Supplementary earning approved",
    resource: `${employee.employeeNo} · ${label}`,
    metadata: {
      earningId: row.id,
      employeeId,
      earningType,
      amount,
      effectiveDate,
      taxable: true,
      includeInSssBase,
      includeInPagIbigBase,
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
  if (!Number.isInteger(id)) {
    return Response.json({ error: "id is required." }, { status: 400 });
  }

  const [existing] = await db.select().from(supplementaryEarnings)
    .where(eq(supplementaryEarnings.id, id))
    .limit(1);
  if (!existing) return Response.json({ error: "Supplementary earning not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    session.id,
    existing.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can void supplementary earnings.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, existing.employeeId))
    .limit(1);
  const access = await getAccess(session.id, existing.organizationId);
  const scope = assertScope(access, employee?.orgUnitId ?? null);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  if (existing.payrollRunId != null || existing.status === "settled") {
    return Response.json({
      error: "A settled supplementary earning is immutable. Use a separately audited adjustment in a later payroll.",
    }, { status: 409 });
  }
  if (existing.status === "void") return Response.json(existing);

  const [row] = await db.update(supplementaryEarnings)
    .set({ status: "void" })
    .where(and(
      eq(supplementaryEarnings.id, id),
      eq(supplementaryEarnings.organizationId, existing.organizationId),
      eq(supplementaryEarnings.status, "approved"),
    ))
    .returning();
  if (!row) {
    return Response.json({ error: "Supplementary earning changed before it could be voided." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: session.name,
    action: "Supplementary earning voided",
    resource: `Earning #${id}`,
    metadata: { earningId: id, employeeId: existing.employeeId, amount: Number(existing.amount) },
  });

  return Response.json(row);
}
