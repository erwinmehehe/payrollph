import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
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
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { resolvePayProfile } from "@/lib/pay-basis";
import { ONBOARDING_TASKS } from "@/lib/provisioning";

export const dynamic = "force-dynamic";

const RECRUITMENT_MANAGER_ROLES = ["owner", "admin", "hr"] as const;

class HireConflict extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "HireConflict";
  }
}

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
    RECRUITMENT_MANAGER_ROLES,
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

  if (!requisition.positionId) {
    return Response.json({
      error: "Hire & onboard requires a requisition linked to an approved workforce position.",
    }, { status: 409 });
  }

  const [position] = await db.select().from(positions)
    .where(and(
      eq(positions.id, requisition.positionId),
      eq(positions.organizationId, applicant.organizationId),
    ))
    .limit(1);
  if (!position) {
    return Response.json({ error: "The requisition's linked position no longer exists." }, { status: 409 });
  }

  const scope = assertScope(access, position.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  if (position.status !== "open") {
    return Response.json({
      error: "The linked position must still be open for recruitment.",
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

  if (!applicant.offeredSalary) {
    return Response.json({ error: "A recorded monthly-equivalent offer is required before Hire & onboard." }, { status: 409 });
  }
  const offeredMonthly = Number(applicant.offeredSalary);
  if (!Number.isFinite(offeredMonthly) || offeredMonthly <= 0) {
    return Response.json({ error: "The recorded offer is invalid and must be corrected before hiring." }, { status: 409 });
  }
  if (Math.abs(payProfile.monthlyEquivalent - offeredMonthly) > 0.01) {
    return Response.json({
      error: "The hire pay profile must match the recorded monthly-equivalent offer.",
      recordedMonthlyOffer: offeredMonthly,
      proposedMonthlyEquivalent: payProfile.monthlyEquivalent,
    }, { status: 409 });
  }

  const annualBudget = Number(position.annualBudget);
  if (annualBudget > 0 && payProfile.monthlyEquivalent * 12 > annualBudget + 0.01) {
    return Response.json({
      error: "The recorded offer exceeds the approved annual position budget.",
      approvedAnnualBudget: annualBudget,
      proposedAnnualizedPay: payProfile.monthlyEquivalent * 12,
    }, { status: 409 });
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

  const [profile] = await db.select().from(jobProfiles)
    .where(and(
      eq(jobProfiles.id, position.jobProfileId),
      eq(jobProfiles.organizationId, applicant.organizationId),
    ))
    .limit(1);
  if (!profile) return Response.json({ error: "The linked job profile no longer exists." }, { status: 409 });
  const title = profile.title;

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

  const resultOrResponse = await db.transaction(async (tx) => {
    // Serialize conversion of one applicant and occupancy of one position. The
    // database unique index is the final backstop; these locks make the losing
    // request fail cleanly before creating an extra employee.
    await tx.execute(sql`select pg_advisory_xact_lock(4101, ${applicant.id})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4103, ${requisition.id})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4102, ${position.id})`);
    await tx.execute(sql`select pg_advisory_xact_lock(4104, hashtext(${String(applicant.organizationId) + ":" + employeeNo}))`);
    if (applicant.email) {
      await tx.execute(sql`select pg_advisory_xact_lock(4105, hashtext(${String(applicant.organizationId) + ":" + applicant.email.toLowerCase()}))`);
    }

    const [freshApplicant] = await tx.select({
      stage: jobApplicants.stage,
      hiredEmployeeId: jobApplicants.hiredEmployeeId,
      offeredSalary: jobApplicants.offeredSalary,
    }).from(jobApplicants).where(eq(jobApplicants.id, applicant.id)).limit(1);
    if (!freshApplicant) throw new HireConflict("Applicant no longer exists.");
    if (freshApplicant.hiredEmployeeId) {
      throw new HireConflict("This candidate has already been hired.", {
        employeeId: freshApplicant.hiredEmployeeId,
      });
    }
    if (freshApplicant.stage !== "offer") {
      throw new HireConflict("The candidate is no longer in the Job Offer stage.", {
        stage: freshApplicant.stage,
      });
    }
    const freshOffer = Number(freshApplicant.offeredSalary);
    if (!Number.isFinite(freshOffer) || freshOffer <= 0) {
      throw new HireConflict("The candidate no longer has a valid recorded offer.");
    }
    if (Math.abs(payProfile.monthlyEquivalent - freshOffer) > 0.01) {
      throw new HireConflict("The hire pay profile no longer matches the recorded monthly-equivalent offer.", {
        recordedMonthlyOffer: freshOffer,
        proposedMonthlyEquivalent: payProfile.monthlyEquivalent,
      });
    }

    const [freshRequisition] = await tx.select({
      status: jobRequisitions.status,
      positionId: jobRequisitions.positionId,
    }).from(jobRequisitions).where(eq(jobRequisitions.id, requisition.id)).limit(1);
    if (!freshRequisition || freshRequisition.positionId !== position.id || ["filled", "cancelled"].includes(freshRequisition.status)) {
      throw new HireConflict("The requisition is no longer available for hiring.");
    }

    const [freshPosition] = await tx.select({
      status: positions.status,
      annualBudget: positions.annualBudget,
    }).from(positions).where(eq(positions.id, position.id)).limit(1);
    if (!freshPosition || freshPosition.status !== "open") {
      throw new HireConflict("The linked position is no longer open for recruitment.", {
        positionStatus: freshPosition?.status ?? "missing",
      });
    }
    const freshAnnualBudget = Number(freshPosition.annualBudget);
    if (freshAnnualBudget > 0 && payProfile.monthlyEquivalent * 12 > freshAnnualBudget + 0.01) {
      throw new HireConflict("The recorded offer now exceeds the approved annual position budget.", {
        approvedAnnualBudget: freshAnnualBudget,
        proposedAnnualizedPay: payProfile.monthlyEquivalent * 12,
      });
    }

    const [duplicateNo] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.organizationId, applicant.organizationId),
      eq(employees.employeeNo, employeeNo),
    )).limit(1);
    if (duplicateNo) throw new HireConflict("That employee number is already in use.");

    if (applicant.email) {
      const [duplicateMail] = await tx.select({ id: employees.id, employeeNo: employees.employeeNo }).from(employees).where(and(
        eq(employees.organizationId, applicant.organizationId),
        eq(employees.email, applicant.email),
      )).limit(1);
      if (duplicateMail) {
        throw new HireConflict("An employee with this candidate email already exists in the workspace.", {
          employeeId: duplicateMail.id,
          employeeNo: duplicateMail.employeeNo,
        });
      }
    }

    {
      const [activeAssignment] = await tx.select({ id: positionAssignments.id })
        .from(positionAssignments)
        .where(and(
          eq(positionAssignments.positionId, position.id),
          isNull(positionAssignments.effectiveUntil),
        ))
        .limit(1);
      if (activeAssignment) {
        throw new HireConflict("The linked position already has an active incumbent.");
      }
    }

    const requisitionStatus = "filled";

    const [employee] = await tx.insert(employees).values({
      organizationId: applicant.organizationId,
      orgUnitId: position.orgUnitId,
      employeeNo,
      firstName,
      middleName: middleName || null,
      lastName,
      title,
      employmentType: employeeEmploymentType(position.employmentType).slice(0, 32),
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

    const [assignment] = await tx.insert(positionAssignments).values({
        organizationId: applicant.organizationId,
        positionId: position.id,
        employeeId: employee.id,
        effectiveFrom: startDate,
        reason: `Hired from requisition #${requisition.id}`,
        createdByUserId: user.id,
      }).returning();
      await tx.update(positions)
        .set({ status: "filled", updatedAt: new Date() })
        .where(eq(positions.id, position.id));

    await tx.update(jobApplicants)
      .set({
        stage: "hired",
        hiredEmployeeId: employee.id,
        hiredByUserId: user.id,
        hiredAt: new Date(),
        offeredSalary: freshApplicant.offeredSalary,
      })
      .where(eq(jobApplicants.id, applicant.id));

    const closedCandidates = await tx.update(jobApplicants)
      .set({ stage: "rejected" })
      .where(and(
        eq(jobApplicants.requisitionId, requisition.id),
        ne(jobApplicants.id, applicant.id),
        notInArray(jobApplicants.stage, ["hired", "rejected"]),
      ))
      .returning({ id: jobApplicants.id });

    await tx.update(jobRequisitions)
      .set({ status: requisitionStatus })
      .where(eq(jobRequisitions.id, requisition.id));

    return { employee, onboarding, assignment, requisitionStatus, closedCandidateCount: closedCandidates.length };
  }).catch((error: unknown) => {
    if (error instanceof HireConflict) {
      return Response.json({ error: error.message, ...error.details }, { status: 409 });
    }
    throw error;
  });

  if (resultOrResponse instanceof Response) return resultOrResponse;
  const result = resultOrResponse;

  await recordAuditEvent({
    organizationId: applicant.organizationId,
    actor: user.name,
    action: "Candidate hired and converted to employee",
    resource: `${applicant.fullName} -> ${result.employee.employeeNo}`,
    metadata: {
      applicantId: applicant.id,
      requisitionId: requisition.id,
      employeeId: result.employee.id,
      positionId: position.id,
      positionCode: position.code,
      positionAssignmentId: result.assignment.id,
      onboardingTasks: result.onboarding.length,
      closedCandidateCount: result.closedCandidateCount,
      startDate,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount,
      monthlyEquivalent: payProfile.monthlyEquivalent,
    },
  });

  return Response.json({
    employee: result.employee,
    onboarding: result.onboarding,
    position: {
      id: position.id,
      code: position.code,
      assignmentId: result.assignment.id,
    },
    requisition: {
      id: requisition.id,
      status: result.requisitionStatus,
    },
  }, { status: 201 });
}
