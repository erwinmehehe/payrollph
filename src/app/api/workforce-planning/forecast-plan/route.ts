import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  positionAssignments,
  positions,
  workforcePlanBaselines,
  workforcePlanningScenarios,
  workforcePlans,
} from "@/db/schema";
import {
  getAccess,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";
import {
  compareHeadcountPlanSummary,
  summarizeHeadcountPlan,
  type HeadcountPlanSummary,
} from "@/lib/workforce-plan-baseline";
import { loadScopedWorkforceForecast } from "@/lib/workforce-forecast-server";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function snapshotHash(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function snapshotRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function baselineHeadcount(snapshot: unknown): HeadcountPlanSummary | null {
  const value = snapshotRecord(snapshot).headcount;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as HeadcountPlanSummary;
  return Number.isFinite(Number(summary.requestedHeadcount)) ? summary : null;
}

function headcountEvidenceWithoutCosts(summary: HeadcountPlanSummary) {
  return {
    ...summary,
    annualPositionBudget: null,
    dimensions: {
      orgUnits: summary.dimensions.orgUnits.map((row) => ({ ...row, annualPositionBudget: null })),
      costCenters: summary.dimensions.costCenters.map((row) => ({ ...row, annualPositionBudget: null })),
      jobProfiles: summary.dimensions.jobProfiles.map((row) => ({ ...row, annualPositionBudget: null })),
    },
  };
}

function baselineAssumptions(snapshot: unknown) {
  const root = snapshotRecord(snapshot);
  const scenario = snapshotRecord(root.scenario);
  const numberOr = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    demandGrowthPercent: numberOr(scenario.demandGrowthPercent, 0),
    vacancyFillPercent: numberOr(scenario.vacancyFillPercent, 100),
    employerLoadPercent: numberOr(scenario.employerLoadPercent, 0),
    annualAttritionPercent: numberOr(scenario.annualAttritionPercent, 0),
    attritionBackfillPercent: numberOr(scenario.attritionBackfillPercent, 100),
  };
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Workforce forecast-plan creation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const planId = Number(body.planId);
  const startDate = String(body.startDate ?? "");
  const endDate = String(body.endDate ?? "");
  const requestedName = String(body.name ?? "").trim().slice(0, 160);

  if (
    !Number.isInteger(organizationId)
    || organizationId <= 0
    || !Number.isInteger(planId)
    || planId <= 0
    || !ISO_DATE.test(startDate)
    || !ISO_DATE.test(endDate)
    || endDate < startDate
  ) {
    return Response.json({
      error: "organizationId, planId, and a valid forecast date range are required.",
    }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) {
    return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  }
  if (!access.companyWide) {
    return Response.json({
      error: "Creating a forecast revision from the official published baseline requires company-wide workforce access.",
    }, { status: 403 });
  }

  const [[plan], [baseline], positionRows, assignmentRows] = await Promise.all([
    db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, planId),
      eq(workforcePlans.organizationId, organizationId),
    )).limit(1),
    db.select().from(workforcePlanBaselines).where(and(
      eq(workforcePlanBaselines.organizationId, organizationId),
      eq(workforcePlanBaselines.planId, planId),
      eq(workforcePlanBaselines.current, true),
    )).orderBy(desc(workforcePlanBaselines.version)).limit(1),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)),
  ]);

  if (!plan) return Response.json({ error: "Workforce plan not found." }, { status: 404 });
  if (!baseline) {
    return Response.json({
      error: "Publish an approved company-wide workforce-plan baseline before starting a forecast revision.",
    }, { status: 409 });
  }

  const lockedHeadcount = baselineHeadcount(baseline.snapshot);
  if (!lockedHeadcount) {
    return Response.json({
      error: "The current workforce-plan baseline is missing authoritative headcount evidence.",
    }, { status: 409 });
  }

  const asOf = todayPh();
  const actualHeadcount = summarizeHeadcountPlan({
    planId,
    asOf,
    scopeOrgUnitId: null,
    positions: positionRows,
    assignments: assignmentRows.map((assignment) => ({
      positionId: assignment.positionId,
      fte: assignment.fte,
      effectiveFrom: String(assignment.effectiveFrom),
      effectiveUntil: assignment.effectiveUntil ? String(assignment.effectiveUntil) : null,
    })),
  });
  const actualVariance = compareHeadcountPlanSummary(lockedHeadcount, actualHeadcount);
  const assumptions = baselineAssumptions(baseline.snapshot);

  try {
    const result = await loadScopedWorkforceForecast({
      userId: user.id,
      organizationId,
      startDate,
      endDate,
      demandGrowthPercent: assumptions.demandGrowthPercent,
      vacancyFillPercent: assumptions.vacancyFillPercent,
      employerLoadPercent: assumptions.employerLoadPercent,
      annualAttritionPercent: assumptions.annualAttritionPercent,
      attritionBackfillPercent: assumptions.attritionBackfillPercent,
      orgUnitId: null,
      worksiteId: null,
    });

    const name = requestedName || `${plan.name} forecast revision`;
    const generatedAt = new Date().toISOString();
    const snapshotBase = {
      version: "hcm-workforce-forecast-revision-v1",
      generatedAt,
      forecast: result.forecast,
      scope: result.scope,
      assumptions,
      linkedPlan: {
        id: plan.id,
        name: plan.name,
        budget: plan.budget,
        startDate: String(plan.startDate),
        endDate: String(plan.endDate),
        status: plan.status,
      },
      planningSeed: {
        kind: "published_baseline_plus_live_actuals",
        baselineId: baseline.id,
        baselineVersion: baseline.version,
        baselineSnapshotHash: baseline.snapshotHash,
        baselinePublishedAt: baseline.publishedAt.toISOString(),
        actualAsOf: asOf,
        lockedHeadcount: headcountEvidenceWithoutCosts(lockedHeadcount),
        actualHeadcount: headcountEvidenceWithoutCosts(actualHeadcount),
        varianceFromBaseline: {
          ...actualVariance,
          annualPositionBudget: null,
        },
      },
      boundary: "This draft is a new forecast revision seeded from the current published baseline and recalculated from current authoritative workforce actuals, including the approved attrition/backfill assumptions. It does not mutate the published baseline, positions, schedules, attendance, employment status, or payroll.",
    };
    const hash = snapshotHash(snapshotBase);

    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workforce_plans where id = ${plan.id} for update`);
      const [previous] = await tx.select({ version: workforcePlanningScenarios.version })
        .from(workforcePlanningScenarios)
        .where(and(
          eq(workforcePlanningScenarios.organizationId, organizationId),
          eq(workforcePlanningScenarios.name, name),
        ))
        .orderBy(desc(workforcePlanningScenarios.version))
        .limit(1);
      const version = (previous?.version ?? 0) + 1;

      const [row] = await tx.insert(workforcePlanningScenarios).values({
        organizationId,
        planId,
        name,
        version,
        scopeOrgUnitId: null,
        worksiteId: null,
        startDate,
        endDate,
        demandGrowthPercent: String(assumptions.demandGrowthPercent),
        vacancyFillPercent: String(assumptions.vacancyFillPercent),
        employerLoadPercent: String(assumptions.employerLoadPercent),
        annualAttritionPercent: String(assumptions.annualAttritionPercent),
        attritionBackfillPercent: String(assumptions.attritionBackfillPercent),
        status: "draft",
        snapshot: snapshotBase,
        snapshotHash: hash,
        createdByUserId: user.id,
      }).returning();
      return row;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Workforce forecast revision created",
      resource: `${created.name} v${created.version}`,
      metadata: {
        scenarioId: created.id,
        planId,
        baselineId: baseline.id,
        baselineVersion: baseline.version,
        baselineSnapshotHash: baseline.snapshotHash,
        snapshotHash: hash,
        actualAsOf: asOf,
        requestedHeadcountVariance: actualVariance.requestedHeadcount,
        approvedHeadcountVariance: actualVariance.approvedHeadcount,
        filledHeadcountVariance: actualVariance.filledHeadcount,
      },
    });

    return Response.json({
      scenario: {
        id: created.id,
        planId: created.planId,
        name: created.name,
        version: created.version,
        status: created.status,
        startDate: created.startDate,
        endDate: created.endDate,
        snapshotHash: created.snapshotHash,
      },
      seed: {
        baselineId: baseline.id,
        baselineVersion: baseline.version,
        baselineSnapshotHash: baseline.snapshotHash,
        actualAsOf: asOf,
        varianceFromBaseline: actualVariance,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forecast revision could not be created.";
    const status = /access|required|outside your assigned/i.test(message) ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}
