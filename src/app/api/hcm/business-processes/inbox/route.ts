import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { canDecide } from "@/lib/delegation";
import {
  completeHcmBusinessProcessWorkItemTx,
  finalizeHcmBusinessProcessSource,
} from "@/lib/hcm-business-process";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function snapshotName(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name : fallback;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });

  const pendingRows = await db.select({
    step: hcmBusinessProcessInstanceSteps,
    instance: hcmBusinessProcessInstances,
    employeeId: employees.id,
    employeeOrgUnitId: employees.orgUnitId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(
      hcmBusinessProcessInstances,
      eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
    )
    .leftJoin(employees, eq(hcmBusinessProcessInstances.employeeId, employees.id))
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
      eq(hcmBusinessProcessInstanceSteps.status, "pending"),
      eq(hcmBusinessProcessInstances.status, "in_progress"),
    ))
    .orderBy(hcmBusinessProcessInstanceSteps.dueAt, hcmBusinessProcessInstanceSteps.id);

  const myWork = [];
  for (const row of pendingRows) {
    if (!access.companyWide && (!row.employeeId || row.employeeOrgUnitId !== access.orgUnitId)) continue;
    const decision = await canDecide(organizationId, row.step.assignee, user.name, user.id);
    if (!decision.permitted) continue;
    myWork.push({
      id: row.step.id,
      stepIndex: row.step.stepIndex,
      stepType: row.step.stepType,
      label: row.step.label,
      assignee: row.step.assignee,
      dueAt: row.step.dueAt,
      approvalTaskId: row.step.approvalTaskId,
      instanceId: row.instance.id,
      processType: row.instance.processType,
      processName: snapshotName(row.instance.definitionSnapshot, row.instance.processType),
      sourceType: row.instance.sourceType,
      sourceKey: row.instance.sourceKey,
      effectiveDate: row.instance.effectiveDate,
      initiatedByName: row.instance.initiatedByName,
      makerBlocked: row.step.stepType === "approval" && row.instance.initiatedByUserId === user.id,
      employee: row.employeeId ? {
        id: row.employeeId,
        employeeNo: row.employeeNo,
        name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        title: row.title,
      } : null,
    });
  }

  const submittedRows = await db.select().from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, organizationId),
    eq(hcmBusinessProcessInstances.initiatedByUserId, user.id),
  )).orderBy(desc(hcmBusinessProcessInstances.initiatedAt)).limit(20);

  const recentRows = access.companyWide
    ? await db.select().from(hcmBusinessProcessInstances).where(eq(
        hcmBusinessProcessInstances.organizationId,
        organizationId,
      )).orderBy(desc(hcmBusinessProcessInstances.updatedAt)).limit(25)
    : submittedRows;

  return Response.json({
    myWork,
    submitted: submittedRows.map((row) => ({
      ...row,
      processName: snapshotName(row.definitionSnapshot, row.processType),
    })),
    recent: recentRows.map((row) => ({
      ...row,
      processName: snapshotName(row.definitionSnapshot, row.processType),
    })),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const stepId = Number(body.stepId);
  const action = String(body.action ?? "complete").trim().toLowerCase();
  const note = String(body.note ?? "").trim();

  if (!Number.isInteger(organizationId) || !Number.isInteger(stepId) || !["complete", "decline"].includes(action)) {
    return Response.json({
      error: "organizationId, stepId, and a complete/decline action are required.",
    }, { status: 400 });
  }
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });

  const [row] = await db.select({
    step: hcmBusinessProcessInstanceSteps,
    instance: hcmBusinessProcessInstances,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(
      hcmBusinessProcessInstances,
      eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
    )
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.id, stepId),
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
    ))
    .limit(1);
  if (!row) return Response.json({ error: "HCM work item not found." }, { status: 404 });
  if (!access.companyWide) {
    const [worker] = row.instance.employeeId
      ? await db.select({ orgUnitId: employees.orgUnitId }).from(employees).where(and(
          eq(employees.id, row.instance.employeeId),
          eq(employees.organizationId, organizationId),
        )).limit(1)
      : [];
    if (!worker || worker.orgUnitId !== access.orgUnitId) {
      return Response.json({
        error: "This HCM work item is outside your assigned organization unit.",
      }, { status: 403 });
    }
  }
  if (row.step.status !== "pending" || row.instance.status !== "in_progress") {
    return Response.json({ error: "This HCM work item is no longer pending." }, { status: 409 });
  }
  if (row.step.stepType === "approval") {
    return Response.json({ error: "Approval steps must be decided from the approval endpoint." }, { status: 409 });
  }

  const decision = await canDecide(organizationId, row.step.assignee, user.name, user.id);
  if (!decision.permitted) {
    return Response.json({ error: "This HCM work item is assigned to another person or role." }, { status: 403 });
  }
  if (row.step.stepType === "review" && row.instance.initiatedByUserId === user.id) {
    return Response.json({
      error: "Maker-checker control: the person who initiated this HCM transaction cannot complete its review step.",
    }, { status: 403 });
  }

  let result;
  try {
    result = await db.transaction((tx) => completeHcmBusinessProcessWorkItemTx(tx, {
      stepId,
      outcome: action === "decline" ? "declined" : "completed",
      actorUserId: user.id,
      actorName: user.name,
      note,
    }));
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The HCM work item could not be completed.",
    }, { status: 409 });
  }

  let source = null;
  if (result.final && result.instanceId) {
    try {
      source = await finalizeHcmBusinessProcessSource({
        instanceId: result.instanceId,
        actorUserId: user.id,
        actorName: user.name,
      });
    } catch (error) {
      source = {
        error: error instanceof Error ? error.message : "The approved HCM source transaction could not be finalized.",
      };
    }
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: action === "decline" ? "HCM business-process review declined" : "HCM business-process work item completed",
    resource: `${row.instance.processType} #${row.instance.id}`,
    metadata: {
      businessProcessInstanceId: row.instance.id,
      businessProcessStepId: row.step.id,
      stepType: row.step.stepType,
      stepIndex: row.step.stepIndex,
      sourceType: row.instance.sourceType,
      sourceKey: row.instance.sourceKey,
      final: result.final,
      status: result.status,
    },
  });

  return Response.json({ result, source });
}
