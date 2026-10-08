import { createHash } from "node:crypto";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  jobRequisitions,
  positionAssignments,
  positions,
  workforcePlanBaselines,
  workforcePlanPositionExecutions,
  workforcePlans,
} from "@/db/schema";
import {
  getAccess,
  PEOPLE_ADMIN_ROLES,
  WORKFORCE_MANAGER_ROLES,
  assertOrganizationRole,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import {
  buildPositionExecutionPreview,
  type WorkforcePlanLivePosition,
  type WorkforcePlanPositionSpec,
} from "@/lib/workforce-plan-position-execution";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function baselinePositionSpecs(snapshot: unknown): WorkforcePlanPositionSpec[] | null {
  const source = record(record(snapshot).positionExecutionSource);
  if (source.version !== "hcm-position-execution-source-v1" || !Array.isArray(source.positions)) {
    return null;
  }
  return source.positions as WorkforcePlanPositionSpec[];
}

function executionLiveState(input: {
  positions: WorkforcePlanLivePosition[];
  activeAssignmentPositionIds: number[];
  activeRequisitionPositionIds: number[];
}) {
  return {
    positions: input.positions
      .map((row) => ({
        id: row.id,
        code: row.code,
        jobProfileId: row.jobProfileId,
        orgUnitId: row.orgUnitId,
        supervisoryOrgUnitId: row.supervisoryOrgUnitId,
        legalEntityId: row.legalEntityId,
        costCenterId: row.costCenterId,
        planId: row.planId,
        managerEmployeeId: row.managerEmployeeId,
        employmentType: row.employmentType,
        status: row.status,
        plannedStartDate: row.plannedStartDate,
        annualBudget: Number(row.annualBudget),
        notes: row.notes,
      }))
      .sort((a, b) => a.id - b.id),
    activeAssignmentPositionIds: [...new Set(input.activeAssignmentPositionIds)].sort((a, b) => a - b),
    activeRequisitionPositionIds: [...new Set(input.activeRequisitionPositionIds)].sort((a, b) => a - b),
  };
}

async function currentPositionState(
  organizationId: number,
  executor: any = db,
) {
  const [positionRows, assignmentRows, requisitionRows] = await Promise.all([
    executor.select().from(positions)
      .where(eq(positions.organizationId, organizationId))
      .orderBy(positions.id),
    executor.select({ positionId: positionAssignments.positionId }).from(positionAssignments)
      .where(and(
        eq(positionAssignments.organizationId, organizationId),
        isNull(positionAssignments.effectiveUntil),
      )),
    executor.select({ positionId: jobRequisitions.positionId }).from(jobRequisitions)
      .where(and(
        eq(jobRequisitions.organizationId, organizationId),
        notInArray(jobRequisitions.status, ["filled", "cancelled"]),
      )),
  ]);

  const livePositions: WorkforcePlanLivePosition[] = positionRows.map((row) => ({
    id: row.id,
    code: row.code,
    jobProfileId: row.jobProfileId,
    orgUnitId: row.orgUnitId,
    supervisoryOrgUnitId: row.supervisoryOrgUnitId,
    legalEntityId: row.legalEntityId,
    costCenterId: row.costCenterId,
    planId: row.planId,
    managerEmployeeId: row.managerEmployeeId,
    employmentType: row.employmentType,
    status: row.status,
    plannedStartDate: row.plannedStartDate ? String(row.plannedStartDate) : null,
    annualBudget: row.annualBudget,
    notes: row.notes,
  }));

  return {
    livePositions,
    activeAssignmentPositionIds: assignmentRows.map((row) => row.positionId),
    activeRequisitionPositionIds: requisitionRows.flatMap((row) => row.positionId == null ? [] : [row.positionId]),
  };
}

async function companyWidePeopleAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only company-wide People administrators can execute a published workforce plan.",
  );
  if (denied) return { denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      denied: Response.json({
        error: "Published-plan position execution requires company-wide People access.",
      }, { status: 403 }),
    };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view published-plan position execution evidence.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Position execution evidence requires company-wide People access." }, { status: 403 });
  }

  const rows = await db.select().from(workforcePlanPositionExecutions)
    .where(eq(workforcePlanPositionExecutions.organizationId, organizationId))
    .orderBy(desc(workforcePlanPositionExecutions.createdAt), desc(workforcePlanPositionExecutions.id));

  return Response.json({
    executions: rows,
    access: {
      companyWide: access.companyWide,
      role: access.role,
      canApply: access.companyWide && PEOPLE_ADMIN_ROLES.includes(access.role as (typeof PEOPLE_ADMIN_ROLES)[number]),
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce plan position execution");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const planId = Number(body.planId);
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !Number.isInteger(planId) || planId <= 0) {
    return Response.json({ error: "organizationId and planId are required." }, { status: 400 });
  }

  const admin = await companyWidePeopleAdmin(user.id, organizationId);
  if ("denied" in admin) return admin.denied;

  const [[plan], [baseline]] = await Promise.all([
    db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, planId),
      eq(workforcePlans.organizationId, organizationId),
    )).limit(1),
    db.select().from(workforcePlanBaselines).where(and(
      eq(workforcePlanBaselines.organizationId, organizationId),
      eq(workforcePlanBaselines.planId, planId),
      eq(workforcePlanBaselines.current, true),
    )).orderBy(desc(workforcePlanBaselines.version)).limit(1),
  ]);
  if (!plan) return Response.json({ error: "Workforce plan not found." }, { status: 404 });
  if (plan.status !== "published" || !baseline) {
    return Response.json({
      error: "Publish the approved workforce plan before creating a position execution preview.",
    }, { status: 409 });
  }

  const baselinePositions = baselinePositionSpecs(baseline.snapshot);
  if (!baselinePositions) {
    return Response.json({
      error: "The current published baseline predates controlled position execution. Publish a new approved baseline to freeze exact executable position evidence.",
      code: "POSITION_EXECUTION_BASELINE_UPGRADE_REQUIRED",
    }, { status: 409 });
  }

  const state = await currentPositionState(organizationId);
  const preview = buildPositionExecutionPreview({
    planId,
    baselinePositions,
    livePositions: state.livePositions,
    activeAssignmentPositionIds: state.activeAssignmentPositionIds,
    activeRequisitionPositionIds: state.activeRequisitionPositionIds,
  });
  const liveState = executionLiveState({
    positions: state.livePositions,
    activeAssignmentPositionIds: state.activeAssignmentPositionIds,
    activeRequisitionPositionIds: state.activeRequisitionPositionIds,
  });
  const liveStateHash = hash(liveState);
  const evidence = {
    version: "hcm-position-execution-preview-v1",
    baselineId: baseline.id,
    baselineVersion: baseline.version,
    baselineSnapshotHash: baseline.snapshotHash,
    planId,
    liveStateHash,
    preview,
  };
  const executionHash = hash(evidence);

  const [existing] = await db.select().from(workforcePlanPositionExecutions).where(and(
    eq(workforcePlanPositionExecutions.organizationId, organizationId),
    eq(workforcePlanPositionExecutions.executionHash, executionHash),
  )).limit(1);
  if (existing) {
    if (existing.status === "cancelled") {
      const [reopened] = await db.update(workforcePlanPositionExecutions).set({
        status: "preview",
        result: {},
      }).where(eq(workforcePlanPositionExecutions.id, existing.id)).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Workforce plan position execution preview reopened",
        resource: `Execution #${existing.id}`,
        metadata: { planId, baselineId: baseline.id, executionHash },
      });
      return Response.json({ execution: reopened, reused: true, reopened: true });
    }
    return Response.json({ execution: existing, reused: true });
  }

  const generatedAt = new Date().toISOString();
  const executionPlan = {
    ...evidence,
    generatedAt,
    boundary: "Preview only. Apply revalidates the current baseline, live position ledger, assignments, requisitions and exact execution hash under locks before any position mutation.",
  };
  const [created] = await db.insert(workforcePlanPositionExecutions).values({
    organizationId,
    planId,
    baselineId: baseline.id,
    baselineSnapshotHash: baseline.snapshotHash,
    status: "preview",
    executionPlan,
    executionHash,
    createdByUserId: user.id,
    createdBy: user.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Workforce plan position execution preview created",
    resource: `${plan.name} · baseline v${baseline.version}`,
    metadata: {
      executionId: created.id,
      planId,
      baselineId: baseline.id,
      baselineSnapshotHash: baseline.snapshotHash,
      executionHash,
      liveStateHash,
      createCount: preview.summary.createCount,
      updateCount: preview.summary.updateCount,
      noopCount: preview.summary.noopCount,
      blockerCount: preview.summary.blockerCount,
    },
  });

  return Response.json({ execution: created, reused: false }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce plan position execution");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const executionId = Number(body.executionId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(executionId) || executionId <= 0 || !["apply", "cancel"].includes(action)) {
    return Response.json({ error: "executionId and action apply/cancel are required." }, { status: 400 });
  }

  const [execution] = await db.select().from(workforcePlanPositionExecutions)
    .where(eq(workforcePlanPositionExecutions.id, executionId))
    .limit(1);
  if (!execution) return Response.json({ error: "Position execution preview not found." }, { status: 404 });

  const admin = await companyWidePeopleAdmin(user.id, execution.organizationId);
  if ("denied" in admin) return admin.denied;

  if (execution.status !== "preview") {
    return Response.json({ error: "Only a preview execution can be applied or cancelled." }, { status: 409 });
  }

  if (action === "cancel") {
    const [cancelled] = await db.update(workforcePlanPositionExecutions).set({
      status: "cancelled",
      result: {
        cancelledAt: new Date().toISOString(),
        cancelledByUserId: user.id,
        cancelledBy: user.name,
      },
    }).where(and(
      eq(workforcePlanPositionExecutions.id, executionId),
      eq(workforcePlanPositionExecutions.status, "preview"),
    )).returning();
    if (!cancelled) return Response.json({ error: "Execution preview changed before cancellation." }, { status: 409 });

    await recordAuditEvent({
      organizationId: execution.organizationId,
      actor: user.name,
      action: "Workforce plan position execution cancelled",
      resource: `Execution #${executionId}`,
      metadata: { planId: execution.planId, baselineId: execution.baselineId, executionHash: execution.executionHash },
    });
    return Response.json({ execution: cancelled });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "workforce-position-execution",
    resourceId: executionId,
    limit: 5,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const storedPlan = record(execution.executionPlan);
  const storedPreview = record(storedPlan.preview);
  const storedSummary = record(storedPreview.summary);
  if (Number(storedSummary.blockerCount ?? 1) > 0) {
    return Response.json({
      error: "This preview contains blockers. Resolve them and create a fresh execution preview before applying.",
    }, { status: 409 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4194, ${execution.planId})`);
      await tx.execute(sql`select id from workforce_plan_position_executions where id = ${executionId} for update`);

      const [freshExecution] = await tx.select().from(workforcePlanPositionExecutions)
        .where(eq(workforcePlanPositionExecutions.id, executionId))
        .limit(1);
      if (!freshExecution || freshExecution.status !== "preview") {
        throw new Error("POSITION_EXECUTION_ALREADY_DECIDED");
      }

      const [[plan], [baseline]] = await Promise.all([
        tx.select().from(workforcePlans).where(and(
          eq(workforcePlans.id, freshExecution.planId),
          eq(workforcePlans.organizationId, freshExecution.organizationId),
        )).limit(1),
        tx.select().from(workforcePlanBaselines).where(and(
          eq(workforcePlanBaselines.id, freshExecution.baselineId),
          eq(workforcePlanBaselines.organizationId, freshExecution.organizationId),
          eq(workforcePlanBaselines.planId, freshExecution.planId),
        )).limit(1),
      ]);
      if (!plan || plan.status !== "published" || !baseline?.current) {
        throw new Error("POSITION_EXECUTION_BASELINE_STALE");
      }
      if (baseline.snapshotHash !== freshExecution.baselineSnapshotHash) {
        throw new Error("POSITION_EXECUTION_BASELINE_STALE");
      }

      const baselinePositions = baselinePositionSpecs(baseline.snapshot);
      if (!baselinePositions) throw new Error("POSITION_EXECUTION_BASELINE_UPGRADE_REQUIRED");

      for (const row of baselinePositions) {
        await tx.execute(sql`select pg_advisory_xact_lock(4102, ${row.sourcePositionId})`);
      }

      const state = await currentPositionState(freshExecution.organizationId, tx);
      const preview = buildPositionExecutionPreview({
        planId: freshExecution.planId,
        baselinePositions,
        livePositions: state.livePositions,
        activeAssignmentPositionIds: state.activeAssignmentPositionIds,
        activeRequisitionPositionIds: state.activeRequisitionPositionIds,
      });
      if (!preview.summary.executable) throw new Error("POSITION_EXECUTION_STATE_CHANGED");

      const liveStateHash = hash(executionLiveState({
        positions: state.livePositions,
        activeAssignmentPositionIds: state.activeAssignmentPositionIds,
        activeRequisitionPositionIds: state.activeRequisitionPositionIds,
      }));
      const evidence = {
        version: "hcm-position-execution-preview-v1",
        baselineId: baseline.id,
        baselineVersion: baseline.version,
        baselineSnapshotHash: baseline.snapshotHash,
        planId: freshExecution.planId,
        liveStateHash,
        preview,
      };
      if (
        hash(evidence) !== freshExecution.executionHash
        || liveStateHash !== storedPlan.liveStateHash
      ) {
        throw new Error("POSITION_EXECUTION_STATE_CHANGED");
      }

      const createdPositions: Array<{ sourcePositionId: number; positionId: number; code: string }> = [];
      const updatedPositions: Array<{ positionId: number; code: string; changedFields: string[] }> = [];

      for (const operation of preview.actions) {
        if (operation.kind === "create") {
          const target = operation.after;
          const [created] = await tx.insert(positions).values({
            organizationId: freshExecution.organizationId,
            code: target.code,
            jobProfileId: target.jobProfileId,
            orgUnitId: target.orgUnitId,
            supervisoryOrgUnitId: target.supervisoryOrgUnitId,
            legalEntityId: target.legalEntityId,
            costCenterId: target.costCenterId,
            planId: target.planId,
            managerEmployeeId: target.managerEmployeeId,
            employmentType: target.employmentType,
            status: "approved",
            plannedStartDate: target.plannedStartDate,
            annualBudget: target.annualBudget.toFixed(2),
            notes: target.notes,
            createdByUserId: user.id,
          }).returning();
          createdPositions.push({
            sourcePositionId: operation.sourcePositionId,
            positionId: created.id,
            code: created.code,
          });
          continue;
        }

        const target = operation.after;
        const [updated] = await tx.update(positions).set({
          jobProfileId: target.jobProfileId,
          orgUnitId: target.orgUnitId,
          supervisoryOrgUnitId: target.supervisoryOrgUnitId,
          legalEntityId: target.legalEntityId,
          costCenterId: target.costCenterId,
          planId: target.planId,
          managerEmployeeId: target.managerEmployeeId,
          employmentType: target.employmentType,
          status: target.status,
          plannedStartDate: target.plannedStartDate,
          annualBudget: target.annualBudget.toFixed(2),
          notes: target.notes,
          updatedAt: new Date(),
        }).where(and(
          eq(positions.id, operation.positionId),
          eq(positions.organizationId, freshExecution.organizationId),
        )).returning();
        if (!updated) throw new Error("POSITION_EXECUTION_STATE_CHANGED");
        updatedPositions.push({
          positionId: updated.id,
          code: updated.code,
          changedFields: operation.changedFields,
        });
      }

      const appliedAt = new Date();
      const resultEvidence = {
        appliedAt: appliedAt.toISOString(),
        baselineId: baseline.id,
        baselineSnapshotHash: baseline.snapshotHash,
        executionHash: freshExecution.executionHash,
        liveStateHash,
        createdPositions,
        updatedPositions,
        noopCount: preview.summary.noopCount,
        boundary: "Position execution never creates incumbents, requisitions, schedules, attendance or payroll entries.",
      };
      const [applied] = await tx.update(workforcePlanPositionExecutions).set({
        status: "applied",
        result: resultEvidence,
        appliedByUserId: user.id,
        appliedBy: user.name,
        appliedAt,
      }).where(and(
        eq(workforcePlanPositionExecutions.id, executionId),
        eq(workforcePlanPositionExecutions.status, "preview"),
      )).returning();
      if (!applied) throw new Error("POSITION_EXECUTION_ALREADY_DECIDED");

      return { applied, resultEvidence };
    });

    await recordAuditEvent({
      organizationId: execution.organizationId,
      actor: user.name,
      action: "Published workforce plan executed to positions",
      resource: `Execution #${executionId}`,
      metadata: {
        executionId,
        planId: execution.planId,
        baselineId: execution.baselineId,
        baselineSnapshotHash: execution.baselineSnapshotHash,
        executionHash: execution.executionHash,
        createdPositions: result.resultEvidence.createdPositions,
        updatedPositions: result.resultEvidence.updatedPositions,
        noopCount: result.resultEvidence.noopCount,
      },
    });

    return Response.json({ execution: result.applied });
  } catch (error) {
    const code = error instanceof Error ? error.message : "POSITION_EXECUTION_FAILED";
    if (code === "POSITION_EXECUTION_ALREADY_DECIDED") {
      return Response.json({ error: "This execution preview was already decided." }, { status: 409 });
    }
    if (code === "POSITION_EXECUTION_BASELINE_STALE") {
      return Response.json({
        error: "The published baseline changed after this preview. Create a fresh execution preview.",
      }, { status: 409 });
    }
    if (code === "POSITION_EXECUTION_BASELINE_UPGRADE_REQUIRED") {
      return Response.json({
        error: "Republish the approved plan to freeze executable position evidence before applying.",
      }, { status: 409 });
    }
    if (code === "POSITION_EXECUTION_STATE_CHANGED") {
      return Response.json({
        error: "The live position, assignment, or requisition state changed after preview. No positions were changed; create a fresh preview.",
        code,
      }, { status: 409 });
    }
    return Response.json({
      error: error instanceof Error ? error.message : "Position execution failed.",
    }, { status: 409 });
  }
}
