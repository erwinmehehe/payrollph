import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deMinimisGrants, employees } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  DE_MINIMIS_2026,
  OT_NIGHT_MEAL_TYPE,
  deMinimisMealTreatment,
  deMinimisTreatment,
  type DeMinimisType,
} from "@/lib/ph-compliance";

export const dynamic = "force-dynamic";

const types = Object.keys(DE_MINIMIS_2026) as DeMinimisType[];

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId") ?? 1);
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage de minimis benefits.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const grants = await db.select().from(deMinimisGrants)
    .where(eq(deMinimisGrants.organizationId, organizationId))
    .orderBy(desc(deMinimisGrants.createdAt));
  const staff = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  const visibleStaff = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleStaff.map((employee) => employee.id));
  const visibleGrants = access.companyWide ? grants : grants.filter((grant) => visibleIds.has(grant.employeeId));

  return Response.json({
    rules: types.map((type) => ({ type, ...DE_MINIMIS_2026[type] })),
    grants: visibleGrants.map((grant) => {
      const benefitType = grant.benefitType as DeMinimisType;
      const treatment = benefitType === OT_NIGHT_MEAL_TYPE
        ? deMinimisMealTreatment({
            amountPerEligibleDay: Number(grant.amount),
            eligibleDays: 1,
            dailyMinimumWage: Number(grant.basisDailyMinimumWage ?? 0),
            asOf: String(grant.effectiveOn),
          })
        : deMinimisTreatment(benefitType, Number(grant.amount), String(grant.effectiveOn));
      return {
        ...grant,
        employeeName: visibleStaff.find((employee) => employee.id === grant.employeeId)
          ? `${visibleStaff.find((employee) => employee.id === grant.employeeId)!.firstName} ${visibleStaff.find((employee) => employee.id === grant.employeeId)!.lastName}`
          : "Unknown employee",
        treatment,
      };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const benefitType = String(body.benefitType ?? "") as DeMinimisType;
  const amount = Number(body.amount);
  const effectiveOn = String(body.effectiveOn ?? "");
  const basisDailyMinimumWage = Number(body.basisDailyMinimumWage);
  const basisWageOrder = String(body.basisWageOrder ?? "").trim();

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage de minimis benefits.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (!types.includes(benefitType) || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) {
    return Response.json({ error: "Employee, valid RR 29-2025 benefit type, positive amount, and effective date are required." }, { status: 422 });
  }
  const isMealAllowance = benefitType === OT_NIGHT_MEAL_TYPE;
  if (
    isMealAllowance
    && (!Number.isFinite(basisDailyMinimumWage) || basisDailyMinimumWage <= 0 || !basisWageOrder)
  ) {
    return Response.json({
      error: "OT/night meal allowance requires the employee's verified applicable daily minimum wage and wage-order/reference.",
    }, { status: 422 });
  }

  const [employee] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const rule = DE_MINIMIS_2026[benefitType];

  if (isMealAllowance) {
    const [existingMealGrant] = await db.select({ id: deMinimisGrants.id })
      .from(deMinimisGrants)
      .where(and(
        eq(deMinimisGrants.organizationId, organizationId),
        eq(deMinimisGrants.employeeId, employeeId),
        eq(deMinimisGrants.benefitType, OT_NIGHT_MEAL_TYPE),
        eq(deMinimisGrants.active, true),
      ))
      .limit(1);
    if (existingMealGrant) {
      return Response.json({
        error: "This employee already has an active OT/night meal allowance. End it before creating a replacement basis.",
      }, { status: 409 });
    }
  }

  let treatment;
  try {
    treatment = isMealAllowance
      ? deMinimisMealTreatment({
          amountPerEligibleDay: amount,
          eligibleDays: 1,
          dailyMinimumWage: basisDailyMinimumWage,
          asOf: effectiveOn,
        })
      : deMinimisTreatment(benefitType, amount, effectiveOn);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "No certified BIR de minimis rule covers this effective date.",
    }, { status: 422 });
  }

  const [grant] = await db.insert(deMinimisGrants).values({
    organizationId,
    employeeId,
    benefitType,
    amount: amount.toFixed(2),
    frequency: rule.period,
    basisDailyMinimumWage: isMealAllowance ? basisDailyMinimumWage.toFixed(2) : null,
    basisWageOrder: isMealAllowance ? basisWageOrder : null,
    effectiveOn,
  }).returning();
  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "De minimis benefit granted",
    resource: `${employee.firstName} ${employee.lastName} · ${rule.label}`,
    metadata: {
      grantId: grant.id,
      amount,
      ceiling: treatment.ceiling,
      excess: treatment.excess,
      ruleVersion: treatment.ruleVersion,
      ...(isMealAllowance ? { basisDailyMinimumWage, basisWageOrder, ceilingRate: 0.30 } : {}),
    },
  });

  return Response.json({ grant, treatment }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
  const [grant] = await db.select().from(deMinimisGrants).where(eq(deMinimisGrants.id, id));
  if (!grant) return Response.json({ error: "Grant not found." }, { status: 404 });
  const denied = await assertOrganizationRole(
    user.id,
    grant.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can end de minimis benefits.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, grant.organizationId);
  const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
    .where(and(eq(employees.id, grant.employeeId), eq(employees.organizationId, grant.organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  await db.update(deMinimisGrants).set({ active: false, endedOn: new Date().toISOString().slice(0, 10) })
    .where(eq(deMinimisGrants.id, id));
  await recordAuditEvent({ organizationId: grant.organizationId, actor: user.name, action: "De minimis benefit ended", resource: `${grant.benefitType} grant ${id}` });
  return Response.json({ ok: true });
}
