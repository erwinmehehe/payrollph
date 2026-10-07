import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  benefitDependents,
  benefitEnrollmentEvents,
  benefitEnrollments,
  benefitPlans,
  employees,
} from "@/db/schema";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  ORG_ADMIN_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely } from "@/lib/automation";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIONSHIPS = new Set(["spouse", "child", "parent", "other"]);
const PROVIDER_STATUSES = new Set(["not_sent", "pending_provider", "confirmed", "rejected"]);
const ENROLLMENT_STATUSES = new Set(["pending", "active", "ended"]);

function hmoPlanWhere(organizationId: number) {
  return and(eq(benefitPlans.organizationId, organizationId), eq(benefitPlans.category, "hmo"));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage HMO benefits.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [plans, staff] = await Promise.all([
    db.select().from(benefitPlans).where(hmoPlanWhere(organizationId)).orderBy(desc(benefitPlans.id)),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
  ]);

  const visibleStaff = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = visibleStaff.map((employee) => employee.id);
  const enrollments = visibleIds.length
    ? await db.select().from(benefitEnrollments).where(and(
        eq(benefitEnrollments.organizationId, organizationId),
        inArray(benefitEnrollments.employeeId, visibleIds),
      ))
    : [];
  const hmoPlanIds = new Set(plans.map((plan) => plan.id));
  const hmoEnrollments = enrollments.filter((row) => hmoPlanIds.has(row.planId));
  const enrollmentIds = hmoEnrollments.map((row) => row.id);

  const [dependents, events] = await Promise.all([
    enrollmentIds.length
      ? db.select().from(benefitDependents).where(and(
          eq(benefitDependents.organizationId, organizationId),
          inArray(benefitDependents.enrollmentId, enrollmentIds),
        ))
      : Promise.resolve([]),
    enrollmentIds.length
      ? db.select().from(benefitEnrollmentEvents).where(and(
          eq(benefitEnrollmentEvents.organizationId, organizationId),
          inArray(benefitEnrollmentEvents.enrollmentId, enrollmentIds),
        )).orderBy(desc(benefitEnrollmentEvents.createdAt))
      : Promise.resolve([]),
  ]);

  const activeEnrollments = hmoEnrollments.filter((row) => row.status === "active");
  const activeDependents = dependents.filter((row) => row.status === "active");
  const pendingProvider = hmoEnrollments.filter((row) => row.providerStatus === "pending_provider").length;

  return Response.json({
    dashboard: {
      activeMembers: activeEnrollments.length,
      activeDependents: activeDependents.length,
      pendingEnrollments: hmoEnrollments.filter((row) => row.status === "pending").length,
      pendingProvider,
      monthlyEmployeeDeductions: activeEnrollments.reduce((sum, row) => sum + Number(row.monthlyContribution), 0)
        + activeDependents.reduce((sum, row) => sum + Number(row.monthlyContribution), 0),
      monthlyEmployerCost: activeEnrollments.reduce((sum, row) => {
        const plan = plans.find((item) => item.id === row.planId);
        return sum + Number(plan?.employerShare ?? 0);
      }, 0),
    },
    plans,
    employees: visibleStaff.map((employee) => ({
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      orgUnitId: employee.orgUnitId,
    })),
    enrollments: hmoEnrollments.map((row) => ({
      ...row,
      dependents: dependents.filter((dependent) => dependent.enrollmentId === row.id),
    })),
    recentEvents: events.slice(0, 50),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "");

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  if (action === "create_plan") {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      ORG_ADMIN_ROLES,
      "Only workspace administrators can configure HMO plans.",
    );
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access?.companyWide) {
      return Response.json({ error: "Only company-wide administrators can configure HMO plans." }, { status: 403 });
    }

    const name = String(body.name ?? "").trim();
    const provider = String(body.provider ?? "").trim();
    const employeeShare = Number(body.employeeShare ?? 0);
    const employerShare = Number(body.employerShare ?? 0);
    const dependentShare = Number(body.dependentShare ?? 0);
    const employerPaidDependents = Number(body.employerPaidDependents ?? 0);
    const waitingPeriodDays = Number(body.waitingPeriodDays ?? 0);
    const annualBenefitLimit = body.annualBenefitLimit === "" || body.annualBenefitLimit == null
      ? null
      : Number(body.annualBenefitLimit);

    if (!name || !provider || ![employeeShare, employerShare, dependentShare, waitingPeriodDays].every(Number.isFinite)) {
      return Response.json({ error: "Name, provider and valid contribution amounts are required." }, { status: 400 });
    }
    if (employeeShare < 0 || employerShare < 0 || dependentShare < 0 || waitingPeriodDays < 0) {
      return Response.json({ error: "HMO amounts and waiting period cannot be negative." }, { status: 422 });
    }
    if (!Number.isInteger(employerPaidDependents) || employerPaidDependents < 0) {
      return Response.json({ error: "Employer-paid dependents must be a non-negative whole number." }, { status: 422 });
    }

    const [plan] = await db.insert(benefitPlans).values({
      organizationId,
      name: name.slice(0, 120),
      category: "hmo",
      provider: provider.slice(0, 80),
      planCode: String(body.planCode ?? "").trim().slice(0, 48) || null,
      contractNumber: String(body.contractNumber ?? "").trim().slice(0, 80) || null,
      contractStart: DATE_RE.test(String(body.contractStart ?? "")) ? String(body.contractStart) : null,
      contractEnd: DATE_RE.test(String(body.contractEnd ?? "")) ? String(body.contractEnd) : null,
      employeeShare: employeeShare.toFixed(2),
      employerShare: employerShare.toFixed(2),
      dependentShare: dependentShare.toFixed(2),
      employerPaidDependents,
      waitingPeriodDays: Math.trunc(waitingPeriodDays),
      annualBenefitLimit: annualBenefitLimit != null && Number.isFinite(annualBenefitLimit)
        ? annualBenefitLimit.toFixed(2)
        : null,
      coverageDetails: typeof body.coverageDetails === "object" && body.coverageDetails && !Array.isArray(body.coverageDetails)
        ? body.coverageDetails
        : {},
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HMO plan created",
      resource: plan.name,
      metadata: { planId: plan.id, provider: plan.provider },
    });

    return Response.json(plan, { status: 201 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can manage HMO benefits.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (action === "add_dependent") {
    const enrollmentId = Number(body.enrollmentId);
    const relationship = String(body.relationship ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const birthDate = String(body.birthDate ?? "");
    if (!Number.isInteger(enrollmentId) || !name || !RELATIONSHIPS.has(relationship) || !DATE_RE.test(birthDate)) {
      return Response.json({ error: "enrollmentId, name, eligible relationship and birthDate are required." }, { status: 400 });
    }

    const [enrollment] = await db.select().from(benefitEnrollments).where(and(
      eq(benefitEnrollments.id, enrollmentId),
      eq(benefitEnrollments.organizationId, organizationId),
    )).limit(1);
    if (!enrollment) return Response.json({ error: "HMO enrollment not found." }, { status: 404 });

    const [plan] = await db.select().from(benefitPlans).where(and(
      eq(benefitPlans.id, enrollment.planId),
      hmoPlanWhere(organizationId),
    )).limit(1);
    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, enrollment.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!plan || !employee) return Response.json({ error: "HMO enrollment is not valid for this workspace." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const existingDependents = await db.select().from(benefitDependents).where(eq(benefitDependents.enrollmentId, enrollment.id));
    const paidSlotsUsed = existingDependents.filter((row) => row.status !== "ended").length;
    const monthlyContribution = paidSlotsUsed < plan.employerPaidDependents ? 0 : Number(plan.dependentShare);

    const [dependent] = await db.insert(benefitDependents).values({
      organizationId,
      enrollmentId: enrollment.id,
      employeeId: enrollment.employeeId,
      name: name.slice(0, 160),
      relationship,
      birthDate,
      sex: String(body.sex ?? "").trim().slice(0, 24) || null,
      status: "pending",
      monthlyContribution: monthlyContribution.toFixed(2),
    }).returning();

    await db.insert(benefitEnrollmentEvents).values({
      organizationId,
      enrollmentId: enrollment.id,
      employeeId: enrollment.employeeId,
      eventType: "dependent_added",
      status: dependent.status,
      metadata: { dependentId: dependent.id, relationship, monthlyContribution },
      actor: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HMO dependent added",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { enrollmentId: enrollment.id, dependentId: dependent.id, relationship },
    });
    await runAutomationEventSafely({
      organizationId,
      employeeId: enrollment.employeeId,
      trigger: "benefit.dependent_added",
      eventKey: `hmo-dependent:${dependent.id}`,
      context: {
        benefitEnrollmentId: enrollment.id,
        benefitPlanId: plan.id,
        benefitPlanName: plan.name,
        benefitProvider: plan.provider,
        dependentId: dependent.id,
        dependentRelationship: relationship,
        dependentMonthlyContribution: monthlyContribution,
      },
    });

    return Response.json(dependent, { status: 201 });
  }

  if (action === "update_dependent") {
    const dependentId = Number(body.dependentId);
    const status = String(body.status ?? "");
    if (!Number.isInteger(dependentId) || !["pending", "active", "rejected", "ended"].includes(status)) {
      return Response.json({ error: "dependentId and a valid dependent status are required." }, { status: 400 });
    }

    const [dependent] = await db.select().from(benefitDependents).where(and(
      eq(benefitDependents.id, dependentId),
      eq(benefitDependents.organizationId, organizationId),
    )).limit(1);
    if (!dependent) return Response.json({ error: "HMO dependent not found." }, { status: 404 });

    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, dependent.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const [updated] = await db.update(benefitDependents).set({
      status,
      providerMemberId: String(body.providerMemberId ?? dependent.providerMemberId ?? "").trim().slice(0, 80) || null,
      updatedAt: new Date(),
    }).where(eq(benefitDependents.id, dependent.id)).returning();

    await db.insert(benefitEnrollmentEvents).values({
      organizationId,
      enrollmentId: dependent.enrollmentId,
      employeeId: dependent.employeeId,
      eventType: "dependent_updated",
      status,
      metadata: { dependentId: dependent.id, relationship: dependent.relationship },
      actor: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HMO dependent updated",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { dependentId: dependent.id, enrollmentId: dependent.enrollmentId, status },
    });

    return Response.json(updated);
  }

  if (action === "update_enrollment") {
    const enrollmentId = Number(body.enrollmentId);
    if (!Number.isInteger(enrollmentId)) {
      return Response.json({ error: "enrollmentId is required." }, { status: 400 });
    }
    const [enrollment] = await db.select().from(benefitEnrollments).where(and(
      eq(benefitEnrollments.id, enrollmentId),
      eq(benefitEnrollments.organizationId, organizationId),
    )).limit(1);
    if (!enrollment) return Response.json({ error: "HMO enrollment not found." }, { status: 404 });

    const [employee] = await db.select().from(employees).where(and(
      eq(employees.id, enrollment.employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1);
    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

    const status = body.status == null ? enrollment.status : String(body.status);
    const providerStatus = body.providerStatus == null ? enrollment.providerStatus : String(body.providerStatus);
    if (!ENROLLMENT_STATUSES.has(status) || !PROVIDER_STATUSES.has(providerStatus)) {
      return Response.json({ error: "Unsupported HMO enrollment or provider status." }, { status: 422 });
    }
    const effectiveOn = body.effectiveOn == null || body.effectiveOn === ""
      ? enrollment.effectiveOn
      : String(body.effectiveOn);
    if (effectiveOn && !DATE_RE.test(effectiveOn)) {
      return Response.json({ error: "effectiveOn must use YYYY-MM-DD." }, { status: 400 });
    }

    const [updated] = await db.update(benefitEnrollments).set({
      status,
      providerStatus,
      providerMemberId: String(body.providerMemberId ?? enrollment.providerMemberId ?? "").trim().slice(0, 80) || null,
      effectiveOn,
      endedOn: status === "ended" ? String(body.endedOn ?? new Date().toISOString().slice(0, 10)) : enrollment.endedOn,
    }).where(eq(benefitEnrollments.id, enrollment.id)).returning();

    const eventType = status === "active" && enrollment.status !== "active"
      ? "coverage_activated"
      : status === "ended" && enrollment.status !== "ended"
        ? "coverage_ended"
        : "enrollment_updated";

    await db.insert(benefitEnrollmentEvents).values({
      organizationId,
      enrollmentId: enrollment.id,
      employeeId: enrollment.employeeId,
      eventType,
      status,
      metadata: { providerStatus, providerMemberId: updated.providerMemberId, effectiveOn: updated.effectiveOn },
      actor: user.name,
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HMO enrollment updated",
      resource: `${employee.firstName} ${employee.lastName}`,
      metadata: { enrollmentId: enrollment.id, status, providerStatus, eventType },
    });

    if (eventType === "coverage_activated" || eventType === "coverage_ended") {
      await runAutomationEventSafely({
        organizationId,
        employeeId: enrollment.employeeId,
        trigger: eventType === "coverage_activated" ? "benefit.coverage_activated" : "benefit.coverage_ended",
        eventKey: `hmo-enrollment:${enrollment.id}:${eventType}`,
        context: {
          benefitEnrollmentId: enrollment.id,
          benefitPlanId: enrollment.planId,
          benefitStatus: status,
          providerStatus,
          effectiveDate: updated.effectiveOn ?? updated.startedOn,
        },
      });
    }

    return Response.json(updated);
  }

  return Response.json({ error: "Unsupported HMO action." }, { status: 400 });
}
