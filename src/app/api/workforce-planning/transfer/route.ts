import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employees, jobProfiles, positionAssignments, positions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely, runLifecycleAutomations } from "@/lib/automation";
import { syncEmployeeHcmObligations } from "@/lib/hcm-documents";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function previousDate(date: string) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const targetPositionId = Number(body.targetPositionId);
  const effectiveFrom = String(body.effectiveFrom ?? todayPh()).trim();
  const reason = String(body.reason ?? "Internal position transfer").trim();
  const movementType = String(body.movementType ?? (/promot/i.test(reason) ? "promotion" : "transfer")).trim().toLowerCase();

  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId) || !Number.isInteger(targetPositionId)) {
    return Response.json({ error: "organizationId, employeeId, and targetPositionId are required." }, { status: 400 });
  }
  if (effectiveFrom !== todayPh()) {
    return Response.json({
      error: "This transfer foundation applies changes on the current Philippine business date only. Future and retroactive transfers require scheduled effective-dated processing.",
    }, { status: 409 });
  }
  if (!reason) return Response.json({ error: "A transfer reason is required." }, { status: 400 });
  if (!["transfer", "promotion", "lateral"].includes(movementType)) {
    return Response.json({ error: "movementType must be transfer, promotion, or lateral." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can transfer an employee between positions.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (employee.status !== "Active") return Response.json({ error: "Only active employees can be transferred." }, { status: 409 });

  const employeeScope = assertScope(access, employee.orgUnitId);
  if (!employeeScope.ok) return Response.json({ error: employeeScope.error }, { status: employeeScope.status });

  const [targetPosition] = await db.select().from(positions).where(and(
    eq(positions.id, targetPositionId),
    eq(positions.organizationId, organizationId),
  )).limit(1);
  if (!targetPosition) return Response.json({ error: "Target position not found in this workspace." }, { status: 404 });
  if (!["approved", "open"].includes(targetPosition.status)) {
    return Response.json({ error: "The target position must be approved or open before transfer." }, { status: 409 });
  }

  const targetScope = assertScope(access, targetPosition.orgUnitId);
  if (!targetScope.ok) {
    return Response.json({
      error: "Cross-unit transfers require company-wide People administration.",
    }, { status: 403 });
  }

  const [targetIncumbent] = await db.select({ id: positionAssignments.id }).from(positionAssignments).where(and(
    eq(positionAssignments.positionId, targetPosition.id),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  if (targetIncumbent) return Response.json({ error: "The target position already has an active incumbent." }, { status: 409 });

  const [currentAssignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  if (!currentAssignment) {
    return Response.json({ error: "Employee does not have an active authoritative position assignment." }, { status: 409 });
  }
  if (currentAssignment.positionId === targetPosition.id) {
    return Response.json({ error: "Employee already occupies the selected target position." }, { status: 409 });
  }
  if (String(currentAssignment.effectiveFrom) >= effectiveFrom) {
    return Response.json({
      error: "The existing position assignment must have at least one completed day before it can be closed by this transfer.",
    }, { status: 409 });
  }

  const [currentPosition] = await db.select().from(positions).where(and(
    eq(positions.id, currentAssignment.positionId),
    eq(positions.organizationId, organizationId),
  )).limit(1);
  if (!currentPosition) return Response.json({ error: "Current position record is missing." }, { status: 409 });

  const [targetProfile] = await db.select().from(jobProfiles).where(and(
    eq(jobProfiles.id, targetPosition.jobProfileId),
    eq(jobProfiles.organizationId, organizationId),
  )).limit(1);
  if (!targetProfile) return Response.json({ error: "Target job profile is missing." }, { status: 409 });

  const result = await db.transaction(async (tx) => {
    const [closed] = await tx.update(positionAssignments).set({
      effectiveUntil: previousDate(effectiveFrom),
    }).where(and(
      eq(positionAssignments.id, currentAssignment.id),
      isNull(positionAssignments.effectiveUntil),
    )).returning();
    if (!closed) throw new Error("The current position assignment changed before transfer.");

    const [newAssignment] = await tx.insert(positionAssignments).values({
      organizationId,
      positionId: targetPosition.id,
      employeeId,
      effectiveFrom,
      reason: reason.slice(0, 240),
      createdByUserId: user.id,
    }).returning();

    await tx.update(positions).set({
      status: "open",
      updatedAt: new Date(),
    }).where(eq(positions.id, currentPosition.id));

    const [filledTarget] = await tx.update(positions).set({
      status: "filled",
      updatedAt: new Date(),
    }).where(and(
      eq(positions.id, targetPosition.id),
      eq(positions.status, targetPosition.status),
    )).returning();
    if (!filledTarget) throw new Error("The target position changed before transfer.");

    const [updatedEmployee] = await tx.update(employees).set({
      orgUnitId: targetPosition.orgUnitId,
      title: targetProfile.title,
      employmentType: targetPosition.employmentType,
    }).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).returning();

    return { closedAssignment: closed, assignment: newAssignment, employee: updatedEmployee };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee transferred between positions",
    resource: employee.firstName + " " + employee.lastName,
    metadata: {
      employeeId,
      fromPositionId: currentPosition.id,
      toPositionId: targetPosition.id,
      fromOrgUnitId: employee.orgUnitId,
      toOrgUnitId: targetPosition.orgUnitId,
      assignmentId: result.assignment.id,
      effectiveFrom,
      reason,
      movementType,
    },
  });

  const hcmObligations = await syncEmployeeHcmObligations({
    organizationId,
    employeeId,
  });

  const automation = await runLifecycleAutomations({
    organizationId,
    employeeId,
    trigger: "employee.moved",
    eventKey: "position-transfer:" + result.assignment.id,
    context: {
      previousOrgUnitId: employee.orgUnitId,
      orgUnitId: result.employee.orgUnitId,
      employmentType: result.employee.employmentType,
      title: result.employee.title,
      previousPositionId: currentPosition.id,
      positionId: targetPosition.id,
      positionCode: targetPosition.code,
      effectiveDate: effectiveFrom,
      movementType,
    },
  });

  if (movementType === "promotion") {
    automation.push(...await runAutomationEventSafely({
      organizationId,
      employeeId,
      trigger: "employee.promoted",
      eventKey: "position-promotion:" + result.assignment.id,
      context: {
        previousOrgUnitId: employee.orgUnitId,
        orgUnitId: result.employee.orgUnitId,
        employmentType: result.employee.employmentType,
        title: result.employee.title,
        previousPositionId: currentPosition.id,
        positionId: targetPosition.id,
        positionCode: targetPosition.code,
        effectiveDate: effectiveFrom,
      },
    }));
  }

  return Response.json({
    employee: result.employee,
    fromPosition: currentPosition,
    toPosition: targetPosition,
    assignment: result.assignment,
    movementType,
    hcmObligations,
    automation,
  }, { status: 201 });
}
