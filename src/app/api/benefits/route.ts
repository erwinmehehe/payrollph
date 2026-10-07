import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { assertOrganizationRole, assertScope, getAccess, ORG_ADMIN_ROLES, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely } from "@/lib/automation";
import { getSessionUser } from "@/lib/auth";
import { validateContribution, type BenefitPlanInput } from "@/lib/benefits";
import { benefitEnrollments, benefitPlans, employees } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage benefits.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [plans, staff] = await Promise.all([
    db.select().from(benefitPlans).where(and(
      eq(benefitPlans.active, true),
      or(isNull(benefitPlans.organizationId), eq(benefitPlans.organizationId, organizationId)),
    )).orderBy(desc(benefitPlans.id)),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
  ]);

  const visibleStaff = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleEmployeeIds = new Set(visibleStaff.map((employee) => employee.id));
  const enrolments = plans.length
    ? (await db.select().from(benefitEnrollments).where(and(
        eq(benefitEnrollments.organizationId, organizationId),
        inArray(benefitEnrollments.planId, plans.map((plan) => plan.id)),
      ))).filter((enrolment) => access.companyWide || visibleEmployeeIds.has(enrolment.employeeId))
    : [];

  return Response.json({
    plans: plans.map((plan) => ({
      ...plan,
      enrolled: enrolments.filter((enrolment) => enrolment.planId === plan.id && enrolment.status === "active").length,
    })),
    employees: visibleStaff.map((employee) => ({
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      monthlyBasic: employee.basicRate,
      enrolments: enrolments.filter((enrolment) => enrolment.employeeId === employee.id),
    })),
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
  const planId = Number(body.planId);
  const monthlyContribution = Number(body.monthlyContribution ?? 0);
  const startedOn = String(body.startedOn ?? "").trim();

  if (!Number.isInteger(organizationId) || organizationId <= 0 || !Number.isInteger(employeeId) || !Number.isInteger(planId) || !/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) {
    return Response.json({ error: "organizationId, employeeId, planId and a YYYY-MM-DD startedOn are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage benefit enrolments.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const [plan] = await db.select().from(benefitPlans).where(and(
    eq(benefitPlans.id, planId),
    or(isNull(benefitPlans.organizationId), eq(benefitPlans.organizationId, organizationId)),
  )).limit(1);
  const [employee] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
  if (!plan || !employee) {
    return Response.json({ error: "Plan or employee not found in this workspace." }, { status: 404 });
  }
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const planInput: BenefitPlanInput = {
    id: plan.id,
    name: plan.name,
    category: plan.category as BenefitPlanInput["category"],
    employeeShare: Number(plan.employeeShare),
    employerShare: Number(plan.employerShare),
    cap: plan.cap == null ? null : Number(plan.cap),
  };
  const monthlyNet = Number(employee.basicRate) * 0.7;
  const check = validateContribution(planInput, monthlyContribution || planInput.employeeShare, monthlyNet);
  if (!check.ok) return Response.json({ error: "Invalid contribution.", problems: check.problems }, { status: 422 });

  const [row] = await db.insert(benefitEnrollments).values({
    organizationId,
    employeeId,
    planId,
    monthlyContribution: (monthlyContribution || Number(plan.employeeShare)).toFixed(2),
    startedOn,
    effectiveOn: startedOn,
    providerStatus: plan.category === "hmo" ? "not_sent" : "confirmed",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Benefit enrolment created",
    resource: `${employee.firstName} ${employee.lastName} · ${plan.name}`,
    metadata: { enrolmentId: row.id, planId, monthlyContribution: row.monthlyContribution },
  });
  await runAutomationEventSafely({
    organizationId,
    employeeId,
    trigger: "benefit.enrollment_created",
    eventKey: `benefit-enrollment:${row.id}`,
    context: {
      benefitEnrollmentId: row.id,
      benefitPlanId: plan.id,
      benefitPlanName: plan.name,
      benefitProvider: plan.provider,
      benefitStatus: row.status,
      providerStatus: row.providerStatus,
      effectiveDate: row.effectiveOn ?? row.startedOn,
    },
  });

  return Response.json(row, { status: 201 });
}

export async function DELETE(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [row] = await db.select().from(benefitEnrollments).where(eq(benefitEnrollments.id, id)).limit(1);
  if (!row) return Response.json({ error: "Enrolment not found." }, { status: 404 });
  const denied = await assertOrganizationRole(
    user.id,
    row.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can end benefit enrolments.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, row.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
    .where(and(eq(employees.id, row.employeeId), eq(employees.organizationId, row.organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  await db.update(benefitEnrollments).set({ status: "ended", endedOn: new Date().toISOString().slice(0, 10) })
    .where(eq(benefitEnrollments.id, id));

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: user.name,
    action: "Benefit enrolment ended",
    resource: `employee ${row.employeeId}`,
    metadata: { enrolmentId: row.id, planId: row.planId },
  });
  const [plan] = await db.select().from(benefitPlans).where(eq(benefitPlans.id, row.planId)).limit(1);
  if (plan?.category === "hmo") {
    await runAutomationEventSafely({
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      trigger: "benefit.coverage_ended",
      eventKey: `benefit-enrollment:${row.id}:ended`,
      context: {
        benefitEnrollmentId: row.id,
        benefitPlanId: row.planId,
        benefitPlanName: plan.name,
        benefitProvider: plan.provider,
        benefitStatus: "ended",
        providerStatus: row.providerStatus,
        effectiveDate: row.effectiveOn ?? row.startedOn,
      },
    });
  }

  return Response.json({ ok: true });
}

/** Seeds the default PH benefit catalogue once per deployment. */
export async function PUT(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    ORG_ADMIN_ROLES,
    "Only workspace administrators can seed the benefit catalogue.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Only company-wide administrators can seed the benefit catalogue." }, { status: 403 });
  }

  const existing = await db.select({ value: benefitPlans.id }).from(benefitPlans);
  if (existing.length > 0) return Response.json({ ok: true, seeded: false });

  await db.insert(benefitPlans).values([
    { name: "HMO, Maxicare Plan A", category: "hmo", employeeShare: "1500.00", employerShare: "2500.00", provider: "Maxicare", organizationId: null },
    { name: "Group life & accident", category: "insurance", employeeShare: "0.00", employerShare: "600.00", provider: "Sun Life", organizationId: null },
    { name: "Pag-IBIG MP2", category: "voluntary", employeeShare: "500.00", employerShare: "0.00", cap: "5000.00", provider: "Pag-IBIG", organizationId: null },
    { name: "SSS Flexi-Fund", category: "voluntary", employeeShare: "0.00", employerShare: "0.00", provider: "SSS", organizationId: null },
    { name: "Rice allowance", category: "allowance", employeeShare: "0.00", employerShare: "1000.00", organizationId: null },
  ]);

  return Response.json({ ok: true, seeded: true });
}
