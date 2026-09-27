import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deMinimisGrants, employees } from "@/db/schema";
import { assertMembership } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { DE_MINIMIS_2026, deMinimisTreatment, type DeMinimisType } from "@/lib/ph-compliance";

export const dynamic = "force-dynamic";

const types = Object.keys(DE_MINIMIS_2026) as DeMinimisType[];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId") ?? 1);
  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const grants = await db.select().from(deMinimisGrants)
    .where(eq(deMinimisGrants.organizationId, organizationId))
    .orderBy(desc(deMinimisGrants.createdAt));
  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));

  return Response.json({
    rules: types.map((type) => ({ type, ...DE_MINIMIS_2026[type] })),
    grants: grants.map((grant) => ({
      ...grant,
      employeeName: staff.find((employee) => employee.id === grant.employeeId)
        ? `${staff.find((employee) => employee.id === grant.employeeId)!.firstName} ${staff.find((employee) => employee.id === grant.employeeId)!.lastName}`
        : "Unknown employee",
      treatment: deMinimisTreatment(grant.benefitType as DeMinimisType, Number(grant.amount)),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const benefitType = String(body.benefitType ?? "") as DeMinimisType;
  const amount = Number(body.amount);
  const effectiveOn = String(body.effectiveOn ?? "");

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;
  if (!types.includes(benefitType) || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
    return Response.json({ error: "Employee, valid RR 29-2025 benefit type, positive amount, and effective date are required." }, { status: 422 });
  }

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee || employee.organizationId !== organizationId) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });

  const rule = DE_MINIMIS_2026[benefitType];
  const [grant] = await db.insert(deMinimisGrants).values({
    organizationId,
    employeeId,
    benefitType,
    amount: amount.toFixed(2),
    frequency: rule.period,
    effectiveOn,
  }).returning();

  const treatment = deMinimisTreatment(benefitType, amount);
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "De minimis benefit granted",
    resource: `${employee.firstName} ${employee.lastName} · ${rule.label}`,
    metadata: { grantId: grant.id, amount, ceiling: rule.ceiling, excess: treatment.excess, ruleVersion: treatment.ruleVersion },
  });

  return Response.json({ grant, treatment }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  const [grant] = await db.select().from(deMinimisGrants).where(eq(deMinimisGrants.id, id));
  if (!grant) return Response.json({ error: "Grant not found." }, { status: 404 });
  const denied = await assertMembership(user.id, grant.organizationId);
  if (denied) return denied;

  await db.update(deMinimisGrants).set({ active: false, endedOn: new Date().toISOString().slice(0, 10) })
    .where(eq(deMinimisGrants.id, id));
  await recordAuditEvent({ organizationId: grant.organizationId, actor: user.name, action: "De minimis benefit ended", resource: `${grant.benefitType} grant ${id}` });
  return Response.json({ ok: true });
}
