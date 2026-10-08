import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalChainInstanceSteps,
  approvalChainInstances,
  approvalChainPolicies,
  approvalTasks,
  workforcePlanBaselines,
  workforcePlanningScenarios,
  workforcePlans,
} from "@/db/schema";
import {
  getAccess,
  PEOPLE_PAYROLL_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { approvalStepsForAmount, validateApprovalChainSteps } from "@/lib/approval-chains";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  loadScopedWorkforceForecast,
  redactWorkforceForecastCosts,
} from "@/lib/workforce-forecast-server";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { workforcePlanApprovalAmount } from "@/lib/workforce-plan-approval";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

function optionalPositiveInt(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function finite(value: unknown, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function snapshotHash(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function scenarioVisibleToAccess(
  scenario: { scopeOrgUnitId: number | null },
  access: { companyWide: boolean; orgUnitId: number | null },
) {
  return access.companyWide || (
    scenario.scopeOrgUnitId != null
    && scenario.scopeOrgUnitId === access.orgUnitId
  );
}

function redactScenarioSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const record = snapshot as Record<string, unknown>;
  const forecast = record.forecast;
  if (!forecast || typeof forecast !== "object" || Array.isArray(forecast)) return snapshot;
  return {
    ...record,
    forecast: redactWorkforceForecastCosts(
      forecast as {
        summary: Record<string, unknown>;
        costCenters: unknown[];
        unallocated: Record<string, unknown>;
      },
    ),
  };
}

async function workforceAccess(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) {
    return null;
  }
  return access;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await workforceAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }
  const canViewCost = roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[]);

  const [rows, instances, policies] = await Promise.all([
    db.select().from(workforcePlanningScenarios)
      .where(eq(workforcePlanningScenarios.organizationId, organizationId))
      .orderBy(desc(workforcePlanningScenarios.createdAt), desc(workforcePlanningScenarios.id)),
    db.select().from(approvalChainInstances).where(and(
      eq(approvalChainInstances.organizationId, organizationId),
      eq(approvalChainInstances.sourceType, "workforce_plan_scenario"),
    )).orderBy(desc(approvalChainInstances.createdAt)),
    db.select().from(approvalChainPolicies).where(and(
      eq(approvalChainPolicies.organizationId, organizationId),
      eq(approvalChainPolicies.purpose, "workforce_plan"),
      eq(approvalChainPolicies.active, true),
    )).orderBy(asc(approvalChainPolicies.id)),
  ]);

  const instanceIds = instances.map((row) => row.id);
  const steps = instanceIds.length
    ? await db.select().from(approvalChainInstanceSteps)
        .where(inArray(approvalChainInstanceSteps.instanceId, instanceIds))
        .orderBy(asc(approvalChainInstanceSteps.instanceId), asc(approvalChainInstanceSteps.stepIndex))
    : [];
  const stepsByInstance = new Map<number, typeof steps>();
  for (const step of steps) {
    stepsByInstance.set(step.instanceId, [...(stepsByInstance.get(step.instanceId) ?? []), step]);
  }
  const instanceByScenarioId = new Map<number, (typeof instances)[number]>();
  for (const instance of instances) {
    const scenarioId = Number(instance.sourceKey);
    if (Number.isInteger(scenarioId) && !instanceByScenarioId.has(scenarioId)) {
      instanceByScenarioId.set(scenarioId, instance);
    }
  }

  return Response.json({
    scenarios: rows
      .filter((row) => scenarioVisibleToAccess(row, access))
      .map((row) => {
        const instance = instanceByScenarioId.get(row.id) ?? null;
        const instanceSteps = instance ? stepsByInstance.get(instance.id) ?? [] : [];
        const currentStep = instance
          ? instanceSteps.find((step) => step.stepIndex === instance.currentStepIndex) ?? null
          : null;
        return {
          ...row,
          snapshot: canViewCost ? row.snapshot : redactScenarioSnapshot(row.snapshot),
          approvalProcess: instance ? {
            instanceId: instance.id,
            policyCode: instance.policyCode,
            policyVersion: instance.policyVersion,
            status: instance.status,
            amount: canViewCost && instance.amount != null ? Number(instance.amount) : null,
            amountBasis: instance.amountBasis,
            currentStepIndex: instance.currentStepIndex,
            currentStep: currentStep ? {
              label: currentStep.label,
              approver: currentStep.approver,
              status: currentStep.status,
              approvalTaskId: currentStep.approvalTaskId,
            } : null,
            steps: instanceSteps.map((step) => ({
              stepIndex: step.stepIndex,
              label: step.label,
              approver: step.approver,
              status: step.status,
              approvalTaskId: step.approvalTaskId,
              decidedBy: step.decidedBy,
              decidedAt: step.decidedAt,
            })),
          } : null,
        };
      }),
    costVisible: canViewCost,
    approvalConfiguration: {
      configured: policies.length === 1,
      conflict: policies.length > 1,
      policy: policies.length === 1 ? {
        id: policies[0].id,
        code: policies[0].code,
        name: policies[0].name,
        version: policies[0].version,
      } : null,
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce staffing scenarios");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const name = String(body.name ?? "").trim().slice(0, 160);
  const planId = optionalPositiveInt(body.planId);
  const orgUnitId = optionalPositiveInt(body.scopeOrgUnitId);
  const worksiteId = optionalPositiveInt(body.worksiteId);
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  const demandGrowthPercent = finite(body.demandGrowthPercent, 0);
  const vacancyFillPercent = finite(body.vacancyFillPercent, 100);
  const employerLoadPercent = finite(body.employerLoadPercent, 0);

  if (
    !Number.isInteger(organizationId)
    || organizationId <= 0
    || name.length < 2
    || !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || Number.isNaN(planId)
    || Number.isNaN(orgUnitId)
    || Number.isNaN(worksiteId)
    || !Number.isFinite(demandGrowthPercent)
    || !Number.isFinite(vacancyFillPercent)
    || !Number.isFinite(employerLoadPercent)
  ) {
    return Response.json({ error: "Valid scenario name, dates, scope and assumptions are required." }, { status: 400 });
  }

  const access = await workforceAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }

  let linkedPlan = null;
  if (planId != null) {
    const [plan] = await db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, planId),
      eq(workforcePlans.organizationId, organizationId),
    )).limit(1);
    if (!plan) return Response.json({ error: "Linked workforce plan not found." }, { status: 404 });
    linkedPlan = plan;
  }

  try {
    const result = await loadScopedWorkforceForecast({
      userId: user.id,
      organizationId,
      startDate,
      endDate,
      demandGrowthPercent,
      vacancyFillPercent,
      employerLoadPercent,
      orgUnitId,
      worksiteId,
    });

    const [previous] = await db.select({ version: workforcePlanningScenarios.version })
      .from(workforcePlanningScenarios)
      .where(and(
        eq(workforcePlanningScenarios.organizationId, organizationId),
        eq(workforcePlanningScenarios.name, name),
      ))
      .orderBy(desc(workforcePlanningScenarios.version))
      .limit(1);
    const version = (previous?.version ?? 0) + 1;
    const snapshot = {
      version: "wfm-staffing-scenario-v2",
      generatedAt: new Date().toISOString(),
      forecast: result.forecast,
      scope: result.scope,
      assumptions: {
        demandGrowthPercent,
        vacancyFillPercent,
        employerLoadPercent,
      },
      linkedPlan: linkedPlan ? {
        id: linkedPlan.id,
        name: linkedPlan.name,
        budget: linkedPlan.budget,
        startDate: String(linkedPlan.startDate),
        endDate: String(linkedPlan.endDate),
        status: linkedPlan.status,
      } : null,
      boundary: "Approved scenario evidence is immutable planning data. It does not mutate payroll, schedules, positions, or staffing requirements.",
    };
    const hash = snapshotHash(snapshot);

    const [created] = await db.insert(workforcePlanningScenarios).values({
      organizationId,
      planId,
      name,
      version,
      scopeOrgUnitId: result.scope.orgUnitId,
      worksiteId,
      startDate,
      endDate,
      demandGrowthPercent: String(demandGrowthPercent),
      vacancyFillPercent: String(vacancyFillPercent),
      employerLoadPercent: String(employerLoadPercent),
      status: "draft",
      snapshot,
      snapshotHash: hash,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Workforce staffing scenario saved",
      resource: `${created.name} v${created.version}`,
      metadata: {
        scenarioId: created.id,
        planId,
        scopeOrgUnitId: created.scopeOrgUnitId,
        worksiteId: created.worksiteId,
        snapshotHash: hash,
      },
    });

    return Response.json({
      scenario: {
        ...created,
        snapshot: result.canViewCost ? created.snapshot : redactScenarioSnapshot(created.snapshot),
      },
      costVisible: result.canViewCost,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scenario could not be calculated.";
    const status = /access|required|outside your assigned/i.test(message) ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce staffing scenario approval");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const scenarioId = Number(body.scenarioId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(scenarioId) || scenarioId <= 0 || action !== "submit") {
    return Response.json({
      error: "Valid scenarioId and submit action are required. Workforce-plan approval decisions are completed from Approvals.",
    }, { status: 400 });
  }

  const [scenario] = await db.select().from(workforcePlanningScenarios)
    .where(eq(workforcePlanningScenarios.id, scenarioId))
    .limit(1);
  if (!scenario) return Response.json({ error: "Staffing scenario not found." }, { status: 404 });

  const access = await workforceAccess(user.id, scenario.organizationId);
  if (!access || !scenarioVisibleToAccess(scenario, access)) {
    return Response.json({ error: "This staffing scenario is outside your workforce scope." }, { status: 403 });
  }
  if (scenario.status !== "draft") {
    return Response.json({ error: "Only draft scenarios can be submitted." }, { status: 409 });
  }
  if (!scenario.planId) {
    return Response.json({ error: "Link this scenario to a workforce plan before submitting it for approval." }, { status: 409 });
  }

  const policies = await db.select().from(approvalChainPolicies).where(and(
    eq(approvalChainPolicies.organizationId, scenario.organizationId),
    eq(approvalChainPolicies.purpose, "workforce_plan"),
    eq(approvalChainPolicies.active, true),
  )).orderBy(asc(approvalChainPolicies.id));
  if (policies.length === 0) {
    return Response.json({
      error: "No active Workforce planning approval chain is configured. Create one in Automation > Approval routing before submitting.",
    }, { status: 409 });
  }
  if (policies.length > 1) {
    return Response.json({
      error: "Multiple active Workforce planning approval chains were found. Keep exactly one active policy before submitting.",
    }, { status: 409 });
  }
  const policy = policies[0];
  const policySteps = validateApprovalChainSteps(policy.steps);
  if (!policySteps) {
    return Response.json({ error: "The active workforce-plan approval chain has an invalid step definition." }, { status: 409 });
  }

  const [currentBaseline] = await db.select().from(workforcePlanBaselines).where(and(
    eq(workforcePlanBaselines.organizationId, scenario.organizationId),
    eq(workforcePlanBaselines.planId, scenario.planId),
    eq(workforcePlanBaselines.current, true),
  )).orderBy(desc(workforcePlanBaselines.version)).limit(1);

  let routing;
  try {
    routing = workforcePlanApprovalAmount({
      scenarioSnapshot: scenario.snapshot,
      currentBaselineSnapshot: currentBaseline?.snapshot ?? null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Could not calculate the workforce-plan approval amount.",
    }, { status: 409 });
  }
  const routedSteps = approvalStepsForAmount(policySteps, routing.amount);
  if (routedSteps.length < 1) {
    return Response.json({ error: "The active workforce-plan approval chain has no applicable step." }, { status: 409 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workforce_planning_scenarios where id = ${scenarioId} for update`);
      const [fresh] = await tx.select().from(workforcePlanningScenarios)
        .where(eq(workforcePlanningScenarios.id, scenarioId))
        .limit(1);
      if (!fresh || fresh.status !== "draft") {
        throw new Error("SCENARIO_SUBMISSION_CONFLICT");
      }

      const [existing] = await tx.select().from(approvalChainInstances).where(and(
        eq(approvalChainInstances.organizationId, fresh.organizationId),
        eq(approvalChainInstances.sourceType, "workforce_plan_scenario"),
        eq(approvalChainInstances.sourceKey, String(fresh.id)),
      )).limit(1);
      if (existing) throw new Error("SCENARIO_APPROVAL_ALREADY_STARTED");

      const [instance] = await tx.insert(approvalChainInstances).values({
        organizationId: fresh.organizationId,
        policyId: policy.id,
        policyCode: policy.code,
        policyVersion: policy.version,
        sourceType: "workforce_plan_scenario",
        sourceKey: String(fresh.id),
        status: "pending",
        currentStepIndex: 0,
        stepsSnapshot: routedSteps,
        amount: routing.amount.toFixed(2),
        amountCurrency: "PHP",
        amountBasis: routing.basis,
        routingSnapshot: {
          ...routing,
          policySteps,
          appliedSteps: routedSteps,
          scenarioSnapshotHash: fresh.snapshotHash,
          planId: fresh.planId,
        },
      }).returning();

      const first = routedSteps[0];
      const [task] = await tx.insert(approvalTasks).values({
        organizationId: fresh.organizationId,
        title: `Workforce plan approval · ${fresh.name} v${fresh.version}`.slice(0, 180),
        detail: `Workforce scenario #${fresh.id} · Plan #${fresh.planId} · routed by governed incremental annual labor cost`.slice(0, 240),
        approver: first.approver,
        dueLabel: first.dueLabel ?? "Workforce plan review required",
        priority: first.priority ?? "High",
        approvalChainInstanceId: instance.id,
        approvalChainStepIndex: 0,
      }).returning();

      const [step] = await tx.insert(approvalChainInstanceSteps).values({
        organizationId: fresh.organizationId,
        instanceId: instance.id,
        stepIndex: 0,
        label: first.label,
        approver: first.approver,
        status: "pending",
        approvalTaskId: task.id,
      }).returning();

      const [updated] = await tx.update(workforcePlanningScenarios).set({
        status: "submitted",
        submittedByUserId: user.id,
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(workforcePlanningScenarios.id, scenarioId),
        eq(workforcePlanningScenarios.status, "draft"),
      )).returning();
      if (!updated) throw new Error("SCENARIO_SUBMISSION_CONFLICT");

      if (updated.planId && updated.scopeOrgUnitId == null && updated.worksiteId == null) {
        const [linkedPlan] = await tx.select({ status: workforcePlans.status }).from(workforcePlans)
          .where(eq(workforcePlans.id, updated.planId))
          .limit(1);
        if (linkedPlan && linkedPlan.status !== "published") {
          await tx.update(workforcePlans)
            .set({ status: "submitted", updatedAt: new Date() })
            .where(eq(workforcePlans.id, updated.planId));
        }
      }

      return { scenario: updated, instance, task, step };
    });

    await recordAuditEvent({
      organizationId: scenario.organizationId,
      actor: user.name,
      action: "Workforce staffing scenario submitted",
      resource: `${scenario.name} v${scenario.version}`,
      metadata: {
        scenarioId,
        planId: scenario.planId,
        snapshotHash: scenario.snapshotHash,
        approvalChainInstanceId: result.instance.id,
        approvalPolicyCode: policy.code,
        approvalPolicyVersion: policy.version,
        approvalTaskId: result.task.id,
        approvalAmount: routing.amount,
        approvalAmountBasis: routing.basis,
        proposedAnnualLaborCost: routing.proposedAnnualLaborCost,
        referenceAnnualLaborCost: routing.referenceAnnualLaborCost,
        routedStepCount: routedSteps.length,
      },
    });

    return Response.json({
      scenario: result.scenario,
      approvalProcess: {
        instanceId: result.instance.id,
        policyCode: result.instance.policyCode,
        policyVersion: result.instance.policyVersion,
        status: result.instance.status,
        amount: roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[]) ? routing.amount : null,
        amountBasis: routing.basis,
        currentStep: {
          label: result.step.label,
          approver: result.step.approver,
          approvalTaskId: result.task.id,
        },
        stepCount: routedSteps.length,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SCENARIO_APPROVAL_ALREADY_STARTED") {
      return Response.json({ error: "This scenario already has an approval process." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "SCENARIO_SUBMISSION_CONFLICT") {
      return Response.json({ error: "This scenario changed while submission was being saved. Refresh and retry." }, { status: 409 });
    }
    throw error;
  }
}
