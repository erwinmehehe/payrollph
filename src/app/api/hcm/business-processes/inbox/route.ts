import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hcmBusinessProcessInstances,
  hcmBusinessProcessInstanceSteps,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getEntitlements } from "@/lib/billing";
import { resolveEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-policy";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { canDecide, loadPeopleHomeAssigneePermissions } from "@/lib/delegation";
import {
  HCM_BP_SCAN_LIMIT, HCM_BP_HISTORY_LIMIT,
  canReadCompanyHcmHistory, projectHcmProcessSummary, reviewDeclineError,
} from "@/lib/hcm-action-center";
import {
  completeHcmBusinessProcessWorkItemTx,
  finalizeHcmBusinessProcessSource,
} from "@/lib/hcm-business-process";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function snapshotName(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const name = (value as Record<string, unknown>).name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 160) : fallback;
}

const privateResponse = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const selected = new URL(request.url).searchParams.get("organizationId");
  const organizationId = selected === null || !/^[1-9][0-9]*$/.test(selected) ? null : Number(selected);
  if (!organizationId || !Number.isSafeInteger(organizationId)) {
    return Response.json({ error: "A positive organizationId is required." }, { status: 400 });
  }
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workspace access required." }, { status: 403 });

  // Read only a bounded candidate page, with both sides of each join bound to
  // the explicitly selected legal employer. Do not hydrate full worker/master
  // records or expose frozen BP sourceEvidence in the response.
  const pendingRows = await db.select({
    stepId: hcmBusinessProcessInstanceSteps.id,
    stepIndex: hcmBusinessProcessInstanceSteps.stepIndex,
    stepType: hcmBusinessProcessInstanceSteps.stepType,
    label: hcmBusinessProcessInstanceSteps.label,
    assignee: hcmBusinessProcessInstanceSteps.assignee,
    dueAt: hcmBusinessProcessInstanceSteps.dueAt,
    approvalTaskId: hcmBusinessProcessInstanceSteps.approvalTaskId,
    instanceId: hcmBusinessProcessInstances.id,
    processType: hcmBusinessProcessInstances.processType,
    definitionSnapshot: hcmBusinessProcessInstances.definitionSnapshot,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedByName: hcmBusinessProcessInstances.initiatedByName,
    initiatedByUserId: hcmBusinessProcessInstances.initiatedByUserId,
    employeeId: employees.id,
    employeeOrgUnitId: employees.orgUnitId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
    title: employees.title,
  }).from(hcmBusinessProcessInstanceSteps)
    .innerJoin(hcmBusinessProcessInstances, and(
      eq(hcmBusinessProcessInstanceSteps.instanceId, hcmBusinessProcessInstances.id),
      eq(hcmBusinessProcessInstances.organizationId, organizationId),
    ))
    .leftJoin(employees, and(
      eq(hcmBusinessProcessInstances.employeeId, employees.id),
      eq(employees.organizationId, organizationId),
    ))
    .where(and(
      eq(hcmBusinessProcessInstanceSteps.organizationId, organizationId),
      eq(hcmBusinessProcessInstanceSteps.status, "pending"),
      eq(hcmBusinessProcessInstances.status, "in_progress"),
    ))
    .orderBy(hcmBusinessProcessInstanceSteps.dueAt, hcmBusinessProcessInstanceSteps.id)
    .limit(HCM_BP_SCAN_LIMIT + 1);

  const candidates = pendingRows.slice(0, HCM_BP_SCAN_LIMIT);
  let permissions: Map<string, boolean>;
  try {
    // One tenant-qualified permission snapshot, not an authorization query per
    // candidate. The actual POST/approval endpoints independently reauthorize.
    permissions = await loadPeopleHomeAssigneePermissions(
      organizationId, Array.from(new Set(candidates.map(row => row.assignee))),
      { id: user.id, name: user.name },
    );
  } catch {
    return Response.json({
      error: "Decision assignment evidence is unavailable; retry from the source workspace.",
    }, { status: 503, ...privateResponse });
  }

  const myWork = [];
  for (const row of candidates) {
    if (!access.companyWide && (!row.employeeId || row.employeeOrgUnitId !== access.orgUnitId)) continue;
    if (!permissions.get(row.assignee)) continue;
    myWork.push({
      id: row.stepId,
      stepIndex: row.stepIndex,
      stepType: row.stepType,
      label: row.label,
      assignee: row.assignee,
      dueAt: row.dueAt,
      approvalTaskId: row.approvalTaskId,
      instanceId: row.instanceId,
      processType: row.processType,
      processName: snapshotName(row.definitionSnapshot, row.processType),
      effectiveDate: row.effectiveDate,
      initiatedByName: row.initiatedByName,
      makerBlocked: ["approval", "review"].includes(row.stepType) &&
        row.initiatedByUserId === user.id,
      employee: row.employeeId ? {
        id: row.employeeId,
        employeeNo: row.employeeNo ?? "",
        name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        title: row.title ?? "",
      } : null,
    });
  }

  const historySelection = {
    id: hcmBusinessProcessInstances.id,
    processType: hcmBusinessProcessInstances.processType,
    status: hcmBusinessProcessInstances.status,
    effectiveDate: hcmBusinessProcessInstances.effectiveDate,
    initiatedByName: hcmBusinessProcessInstances.initiatedByName,
    initiatedAt: hcmBusinessProcessInstances.initiatedAt,
    completedAt: hcmBusinessProcessInstances.completedAt,
    employeeId: hcmBusinessProcessInstances.employeeId,
    definitionSnapshot: hcmBusinessProcessInstances.definitionSnapshot,
  };
  const submittedRows = await db.select(historySelection).from(hcmBusinessProcessInstances).where(and(
    eq(hcmBusinessProcessInstances.organizationId, organizationId),
    eq(hcmBusinessProcessInstances.initiatedByUserId, user.id),
  )).orderBy(desc(hcmBusinessProcessInstances.initiatedAt))
    .limit(HCM_BP_HISTORY_LIMIT + 1);

  // A role alone cannot override a deny-only People permission assignment.
  const canReadHistoryByRole = canReadCompanyHcmHistory(access) &&
    !(await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES));
  // Only the company-wide history preview is Enterprise paid-depth. Never
  // block assigned work, the actor's submissions or governed POST decisions.
  // Non-enrolled employers incur zero billing queries and retain pilot access.
  const historyPlan = canReadHistoryByRole
    ? await resolveEnterpriseHcmPlan(organizationId, process.env, getEntitlements)
    : "not-enforced";
  const recentAllowed = canReadHistoryByRole &&
    (historyPlan === "allowed" || historyPlan === "not-enforced");
  const recentRows = recentAllowed
    ? await db.select(historySelection).from(hcmBusinessProcessInstances)
      .where(eq(hcmBusinessProcessInstances.organizationId, organizationId))
      .orderBy(desc(hcmBusinessProcessInstances.updatedAt))
      .limit(HCM_BP_HISTORY_LIMIT + 1)
    : submittedRows;

  return Response.json({
    organizationId,
    myWork,
    submitted: submittedRows.slice(0, HCM_BP_HISTORY_LIMIT).map(projectHcmProcessSummary),
    recent: recentRows.slice(0, HCM_BP_HISTORY_LIMIT).map(projectHcmProcessSummary),
    meta: {
      myWorkPartial: pendingRows.length > HCM_BP_SCAN_LIMIT,
      submittedPartial: submittedRows.length > HCM_BP_HISTORY_LIMIT,
      recentPartial: recentRows.length > HCM_BP_HISTORY_LIMIT,
      companyHistoryAvailable: recentAllowed,
    },
  }, privateResponse);
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
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(stepId) || stepId <= 0 || !["complete", "decline"].includes(action)) {
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
      eq(hcmBusinessProcessInstances.organizationId, organizationId),
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
  const declineError = reviewDeclineError(action, row.step.stepType, body.note);
  if (declineError) return Response.json({ error: declineError }, { status: 400 });

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
