import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayProfiles,
  employees,
  jobApplicants,
  jobProfiles,
  jobRequisitions,
  positionAssignments,
  positions,
  provisioningTasks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { resolvePayProfile } from "@/lib/pay-basis";
import { ONBOARDING_TASKS } from "@/lib/provisioning";

export const dynamic = "force-dynamic";

function employeeEmploymentType(value: string) {
  if (value === "Full-time") return "Regular";
  return value;
}

function cleanName(value: unknown, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const applicantId = Number(body.applicantId);
  const startDate = String(body.startDate ?? "").trim();
  const firstName = cleanName(body.firstName);
  const middleName = cleanName(body.middleName);
  const lastName = cleanName(body.lastName);
  const region = String(body.region ?? "NCR").trim().slice(0, 32) || "NCR";

  if (!Number.isInteger(applicantId)) {
    return Response.json({ error: "applicantId is required." }, { status: 400 });
  }
  if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "firstName, lastName, and YYYY-MM-DD startDate are required." }, { status: 400 });
  }

  let payProfile;
  try {
    payProfile = resolvePayProfile({
      payBasis: String(body.payBasis ?? "monthly"),
      rateAmount: Number(body.rateAmount),
      standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? 22),
      standardHoursPerDay: Number(body.standardHoursPerDay ?? 8),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Pay profile is invalid.",
    }, { status: 400 });
  }

  const [applicant] = await db.select().from(jobApplicants)
    .where(eq(jobApplicants.id, applicantId))
    .limit(1);
  if (!applicant) return Response.json({ error: "Applicant not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    applicant.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to hire candidates.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, applicant.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (applicant.hiredEmployeeId) {
    return Response.json({
      error: "This candidate has already been hired.",
      employeeId: applicant.hiredEmployeeId,
    }, { status: 409 });
  }
  if (applicant.stage !== "offer") {
    return Response.json({
      error: "A candidate must be in the Job Offer stage before Hire & onboard can run.",
      stage: applicant.stage,
    }, { status: 409 });
  }

  const [requisition] = await db.select().from(jobRequisitions)
    .where(and(
      eq(jobRequisitions.id, applicant.requisitionId),
      eq(jobRequisitions.organizationId, applicant.organizationId),
    ))
    .limit(1);
  if (!requisition) return Response.json({ error: "Requisition not found." }, { status: 404 });
  if (requisition.status === "cancelled") {
    return Response.json({ error: "This requisition has been cancelled." }, { status: 409 });
  }

  const [position] = requisition.positionId
    ? await db.select().from(positions)
        .where(and(
          eq(positions.id, requisition.positionId),
          eq(positions.organizationId, applicant.organizationId),
        ))
        .limit(1)
    : [];

  if (position) {
    const scope = assertScope(access, position.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
    if (!["open", "approved"].includes(position.status)) {
      return Response.json({
        error: "The linked position is no longer available for hiring.",
        positionStatus: position.status,
      }, { status: 409 });
    }

    const [activeAssignment] = await db.select({ id: positionAssignments.id })
      .from(positionAssignments)
      .where(and(
        eq(positionAssignments.positionId, position.id),
        isNull(positionAssignments.effectiveUntil),
      ))
      .limit(1);
    if (activeAssignment) {
      return Response.json({ error: "The linked position already has an active incumbent." }, { status: 409 });
    }

    const annualBudget = Number(position.annualBudget);
    if (annualBudget > 0 && payProfile.monthlyEquivalent * 12 > annualBudget + 0.01) {
      return Response.json({
        error: "The proposed pay exceeds the approved annual position budget.",
        approvedAnnualBudget: annualBudget,
        proposedAnnualizedPay: payProfile.monthlyEquivalent * 12,
      }, { status: 409 });
    }
  } else if (!access.companyWide) {
    return Response.json({
      error: "This legacy requisition is not linked to a scoped position. A company-wide People admin must complete the hire.",
    }, { status: 403 });
  }

  const [duplicateEmail] = applicant.email
    ? await db.select({ id: employees.id, employeeNo: employees.employeeNo })
        .from(employees)
        .where(and(
          eq(employees.organizationId, applicant.organizationId),
          eq(employees.email, applicant.email),
        ))
        .limit(1)
    : [];
  if (duplicateEmail) {
    return Response.json({
      error: "An employee with this candidate email already exists in the workspace.",
      employeeId: duplicateEmail.id,
      employeeNo: duplicateEmail.employeeNo,
    }, { status: 409 });
  }

  let title = requisition.title;
  if (position) {
    const [profile] = await db.select().from(jobProfiles)
      .where(and(
        eq(jobProfiles.id, position.jobProfileId),
        eq(jobProfiles.organizationId, applicant.organizationId),
      ))
      .limit(1);
    if (!profile) return Response.json({ error: "The linked job profile no longer exists." }, { status: 409 });
    title = profile.title;
  }

  const reqApplicants = await db.select({
    id: jobApplicants.id,
    stage: jobApplicants.stage,
  }).from(jobApplicants).where(and(
    eq(jobApplicants.organizationId, applicant.organizationId),
    eq(jobApplicants.requisitionId, requisition.id),
    ne(jobApplicants.id, applicant.id),
  ));
  const otherHires = reqApplicants.filter((row) => row.stage === "hired").length;
  const requisitionWillBeFilled = Boolean(position) || otherHires + 1 >= requisition.headcount;

  const employeeNo = String(
    body.employeeNo ?? `EMP-H${String(applicant.id).padStart(5, "0")}`,
  ).trim().slice(0, 32);
  if (!employeeNo) return Response.json({ error: "employeeNo is required." }, { status: 400 });

  const [duplicateEmployeeNo] = await db.select({ id: employees.id })
    .from(employees)
    .where(and(
      eq(employees.organizationId, applicant.organizationId),
      eq(employees.employeeNo, employeeNo),
    ))
    .limit(1);
  if (duplicateEmployeeNo) {
    return Response.json({ error: "That employee number is already in use." }, { status: 409 });
  }

  const result = await db.transaction(async (tx) => {
    const [employee] = await tx.insert(employees).values({
      organizationId: applicant.organizationId,
      orgUnitId: position?.orgUnitId ?? null,
      employeeNo,
      firstName,
      middleName: middleName || null,
      lastName,
      title,
      employmentType: employeeEmploymentType(position?.employmentType ?? requisition.employmentType).slice(0, 32),
      status: "Active",
      avatarInitials: `${firstName[0] ?? "?"}${lastName[0] ?? "?"}`.toUpperCase(),
      basicRate: payProfile.monthlyEquivalent.toFixed(2),
      mwe: Boolean(body.mwe),
      region,
      email: applicant.email || null,
      mobile: applicant.phone || null,
      nationality: String(body.nationality ?? "Filipino").trim().slice(0, 60) || "Filipino",
      startDate,
    }).returning();

    await tx.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId: applicant.organizationId,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
    });

    const onboarding = await tx.insert(provisioningTasks).values(
      ONBOARDING_TASKS.map((task) => ({
        organizationId: applicant.organizationId,
        employeeId: employee.id,
        kind: "onboarding",
        title: task.title,
        owner: task.owner,
      })),
    ).returning();

    let assignment: typeof positionAssignments.$inferSelect | null = null;
    if (position) {
      const [createdAssignment] = await tx.insert(positionAssignments).values({
        organizationId: applicant.organizationId,
        positionId: position.id,
        employeeId: employee.id,
        effectiveFrom: startDate,
        reason: `Hired from requisition #${requisition.id}`,
        createdByUserId: user.id,
      }).returning();
      assignment = createdAssignment;

      await tx.update(positions)
        .set({ status: "filled", updatedAt: new Date() })
        .where(eq(positions.id, position.id));
    }

    await tx.update(jobApplicants)
      .set({
        stage: "hired",
        hiredEmployeeId: employee.id,
        hiredByUserId: user.id,
        hiredAt: new Date(),
        offeredSalary: payProfile.monthlyEquivalent.toFixed(2),
      })
      .where(eq(jobApplicants.id, applicant.id));

    await tx.update(jobRequisitions)
      .set({ status: requisitionWillBeFilled ? "filled" : "interviewing" })
      .where(eq(jobRequisitions.id, requisition.id));

    return { employee, onboarding, assignment };
  });

  await recordAuditEvent({
    organizationId: applicant.organizationId,
    actor: user.name,
    action: "Candidate hired and converted to employee",
    resource: `${applicant.fullName} -> ${result.employee.employeeNo}`,
    metadata: {
      applicantId: applicant.id,
      requisitionId: requisition.id,
      employeeId: result.employee.id,
      positionId: position?.id ?? null,
      positionCode: position?.code ?? null,
      positionAssignmentId: result.assignment?.id ?? null,
      onboardingTasks: result.onboarding.length,
      startDate,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount,
      monthlyEquivalent: payProfile.monthlyEquivalent,
    },
  });

  return Response.json({
    employee: result.employee,
    onboarding: result.onboarding,
    position: position ? {
      id: position.id,
      code: position.code,
      assignmentId: result.assignment?.id ?? null,
    } : null,
    requisition: {
      id: requisition.id,
      status: requisitionWillBeFilled ? "filled" : "interviewing",
    },
  }, { status: 201 });
}
