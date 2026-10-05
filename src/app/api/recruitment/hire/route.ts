import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, isNull } from "drizzle-orm";
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
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { resolvePayProfile } from "@/lib/pay-basis";
import { runLifecycleAutomations } from "@/lib/automation";

export const dynamic = "force-dynamic";

const ONBOARDING = [
  { title: "Government IDs on file (SSS / PhilHealth / Pag-IBIG / TIN)", owner: "People Ops" },
  { title: "Payroll bank / GCash account verified", owner: "Finance" },
  { title: "Laptop / workstation assigned", owner: "IT" },
  { title: "Email and software accounts provisioned", owner: "IT" },
  { title: "HMO enrollment submitted", owner: "People Ops" },
];

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const applicantId = Number(body.applicantId);
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const region = String(body.region ?? "NCR").trim() || "NCR";

  if (!Number.isInteger(organizationId) || !Number.isInteger(applicantId)) {
    return Response.json({ error: "organizationId and applicantId are required." }, { status: 400 });
  }
  if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "firstName, lastName, and YYYY-MM-DD startDate are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can convert a candidate into an employee.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [applicant] = await db.select().from(jobApplicants)
    .where(and(eq(jobApplicants.id, applicantId), eq(jobApplicants.organizationId, organizationId)))
    .limit(1);
  if (!applicant) return Response.json({ error: "Candidate not found in this workspace." }, { status: 404 });
  if (applicant.hiredEmployeeId || applicant.stage === "hired") {
    return Response.json({ error: "This candidate has already been hired.", employeeId: applicant.hiredEmployeeId }, { status: 409 });
  }
  if (applicant.stage !== "offer") {
    return Response.json({ error: "A candidate must be in the offer stage before hiring." }, { status: 409 });
  }
  if (!applicant.offeredSalary || Number(applicant.offeredSalary) <= 0) {
    return Response.json({ error: "Record the accepted monthly salary before hiring." }, { status: 409 });
  }

  const [requisition] = await db.select().from(jobRequisitions)
    .where(and(eq(jobRequisitions.id, applicant.requisitionId), eq(jobRequisitions.organizationId, organizationId)))
    .limit(1);
  if (!requisition) return Response.json({ error: "Candidate requisition is missing." }, { status: 409 });
  if (!requisition.positionId || !requisition.jobProfileId) {
    return Response.json({ error: "This requisition is not linked to an approved workforce position." }, { status: 409 });
  }
  if (!access.companyWide && requisition.orgUnitId !== access.orgUnitId) {
    return Response.json({ error: "That candidate is outside your assigned organization unit." }, { status: 403 });
  }
  if (["filled", "cancelled"].includes(requisition.status)) {
    return Response.json({ error: "This requisition is already closed." }, { status: 409 });
  }

  const [position] = await db.select().from(positions)
    .where(and(eq(positions.id, requisition.positionId), eq(positions.organizationId, organizationId)))
    .limit(1);
  if (!position) return Response.json({ error: "The linked position no longer exists." }, { status: 409 });
  if (!["approved", "open"].includes(position.status)) {
    return Response.json({ error: "The linked position is not available for hire." }, { status: 409 });
  }

  const [activeAssignment] = await db.select({ id: positionAssignments.id })
    .from(positionAssignments)
    .where(and(eq(positionAssignments.positionId, position.id), isNull(positionAssignments.effectiveUntil)))
    .limit(1);
  if (activeAssignment) {
    return Response.json({ error: "The linked position already has an active incumbent." }, { status: 409 });
  }

  const [profile] = await db.select().from(jobProfiles)
    .where(and(eq(jobProfiles.id, requisition.jobProfileId), eq(jobProfiles.organizationId, organizationId)))
    .limit(1);
  if (!profile) return Response.json({ error: "The linked job profile no longer exists." }, { status: 409 });

  const offeredSalary = Number(applicant.offeredSalary);
  if (requisition.salaryMax && offeredSalary > Number(requisition.salaryMax)) {
    return Response.json({
      error: "The accepted salary exceeds the approved requisition budget. Update the position/requisition budget before hiring.",
    }, { status: 409 });
  }

  let payProfile;
  try {
    payProfile = resolvePayProfile({
      payBasis: "monthly",
      rateAmount: offeredSalary,
      standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? 22),
      standardHoursPerDay: Number(body.standardHoursPerDay ?? 8),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pay profile is invalid." }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const existingRows = await tx.select({ id: employees.id })
      .from(employees)
      .where(eq(employees.organizationId, organizationId));
    const employeeNo = "EMP-" + String(existingRows.length + 1).padStart(4, "0");

    const [employee] = await tx.insert(employees).values({
      organizationId,
      orgUnitId: requisition.orgUnitId,
      employeeNo,
      firstName,
      lastName,
      title: profile.title,
      employmentType: position.employmentType,
      status: "Active",
      avatarInitials: ((firstName[0] ?? "?") + (lastName[0] ?? "?")).toUpperCase(),
      basicRate: payProfile.monthlyEquivalent.toFixed(2),
      mwe: false,
      region,
      restDay: null,
      email: applicant.email || null,
      mobile: applicant.phone || null,
      nationality: "Filipino",
      startDate,
    }).returning();

    await tx.insert(employeePayProfiles).values({
      employeeId: employee.id,
      organizationId,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
    });

    const [assignment] = await tx.insert(positionAssignments).values({
      organizationId,
      positionId: position.id,
      employeeId: employee.id,
      effectiveFrom: startDate,
      reason: "Candidate hired from requisition #" + requisition.id,
      createdByUserId: user.id,
    }).returning();

    const onboarding = await tx.insert(provisioningTasks).values(ONBOARDING.map((item) => ({
      organizationId,
      employeeId: employee.id,
      kind: "onboarding",
      title: item.title,
      owner: item.owner,
    }))).returning();

    await tx.update(positions)
      .set({ status: "filled", updatedAt: new Date() })
      .where(eq(positions.id, position.id));

    await tx.update(jobRequisitions)
      .set({ status: "filled" })
      .where(eq(jobRequisitions.id, requisition.id));

    await tx.update(jobApplicants)
      .set({ stage: "hired", hiredEmployeeId: employee.id, hiredAt: new Date() })
      .where(eq(jobApplicants.id, applicant.id));

    return { employee, assignment, onboarding };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Candidate hired into planned position",
    resource: applicant.fullName + " -> " + position.code,
    metadata: {
      applicantId: applicant.id,
      requisitionId: requisition.id,
      positionId: position.id,
      employeeId: result.employee.id,
      assignmentId: result.assignment.id,
      startDate,
      monthlyRate: payProfile.rateAmount,
      onboardingTasks: result.onboarding.length,
    },
  });

  const automation = await runLifecycleAutomations({
    organizationId,
    employeeId: result.employee.id,
    trigger: "employee.hired",
    eventKey: "candidate-hire:" + applicant.id,
    context: {
      orgUnitId: result.employee.orgUnitId,
      employmentType: result.employee.employmentType,
      title: result.employee.title,
    },
  });

  return Response.json({
    employee: result.employee,
    position,
    assignment: result.assignment,
    onboarding: result.onboarding,
    automation,
    candidate: { ...applicant, stage: "hired", hiredEmployeeId: result.employee.id },
  }, { status: 201 });
}
