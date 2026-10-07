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
  PEOPLE_ADMIN_ROLES,
  PEOPLE_PAYROLL_ROLES,
  WORKFORCE_MANAGER_ROLES,
  assertOrganizationRole,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  compareHeadcountPlanSummary,
  summarizeHeadcountPlan,
  type HeadcountPlanSummary,
} from "@/lib/workforce-plan-baseline";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

function roleAllowed(role: string, roles: readonly string[]) {
  return roles.includes(role);
}

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshotRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractForecastSummary(snapshot: unknown) {
  const root = snapshotRecord(snapshot);
  const forecast = snapshotRecord(root.forecast);
  const summary = snapshotRecord(forecast.summary);
  if (Object.keys(summary).length === 0) return null;
  return {
    activeHeadcount: numeric(summary.activeHeadcount),
    vacantPositions: numeric(summary.vacantPositions),
    expectedVacancyFills: numeric(summary.expectedVacancyFills),
    capacityCoveragePercent: numeric(summary.capacityCoveragePercent),
    annualRunRateLaborCost: numeric(summary.annualRunRateLaborCost),
    forecastPeriodLaborCost: numeric(summary.forecastPeriodLaborCost),
  };
}

function baselineSummary(snapshot: unknown): HeadcountPlanSummary | null {
  const row = snapshotRecord(snapshot).headcount;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const summary = row as HeadcountPlanSummary;
  return Number.isFinite(Number(summary.requestedHeadcount)) ? summary : null;
}

function redactSummaryCosts(summary: HeadcountPlanSummary) {
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

function redactSnapshotCosts(snapshot: unknown) {
  const root = snapshotRecord(snapshot);
  const headcount = baselineSummary(snapshot);
  const plan = snapshotRecord(root.plan);
  const forecast = snapshotRecord(root.forecast);
  return {
    ...root,
    plan: { ...plan, budget: null },
    headcount: headcount ? redactSummaryCosts(headcount) : root.headcount,
    forecast: Object.keys(forecast).length
      ? {
          ...forecast,
          annualRunRateLaborCost: null,
          forecastPeriodLaborCost: null,
        }
      : root.forecast,
  };
}

async function planningAccess(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access || !roleAllowed(access.role, WORKFORCE_MANAGER_ROLES as readonly string[])) return null;
  return access;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const includeHistory = url.searchParams.get("history") === "1";
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const access = await planningAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "Workforce-manager access is required." }, { status: 403 });
  const canViewCost = roleAllowed(access.role, PEOPLE_PAYROLL_ROLES as readonly string[]);

  const [baselineRows, positionRows, assignmentRows] = await Promise.all([
    db.select().from(workforcePlanBaselines)
      .where(eq(workforcePlanBaselines.organizationId, organizationId))
      .orderBy(desc(workforcePlanBaselines.current), desc(workforcePlanBaselines.publishedAt), desc(workforcePlanBaselines.id)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)),
  ]);

  const asOf = todayPh();
  const visible = baselineRows.filter((row) =>
    (includeHistory || row.current)
    && (access.companyWide || (row.scopeOrgUnitId != null && row.scopeOrgUnitId === access.orgUnitId))
  );

  return Response.json({
    costVisible: canViewCost,
    asOf,
    baselines: visible.map((row) => {
      const baseline = baselineSummary(row.snapshot);
      const actual = summarizeHeadcountPlan({
        planId: row.planId,
        asOf,
        scopeOrgUnitId: row.scopeOrgUnitId,
        positions: positionRows,
        assignments: assignmentRows.map((assignment) => ({
          positionId: assignment.positionId,
          fte: assignment.fte,
          effectiveFrom: String(assignment.effectiveFrom),
          effectiveUntil: assignment.effectiveUntil ? String(assignment.effectiveUntil) : null,
        })),
      });
      const variance = baseline ? compareHeadcountPlanSummary(baseline, actual) : null;
      return {
        ...row,
        snapshot: canViewCost ? row.snapshot : redactSnapshotCosts(row.snapshot),
        actual: canViewCost ? actual : redactSummaryCosts(actual),
        variance: variance
          ? {
              ...variance,
              annualPositionBudget: canViewCost ? variance.annualPositionBudget : null,
            }
          : null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Published headcount plans");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const scenarioId = Number(body.scenarioId);
  if (!Number.isInteger(scenarioId) || scenarioId <= 0) {
    return Response.json({ error: "scenarioId is required." }, { status: 400 });
  }

  const [scenario] = await db.select().from(workforcePlanningScenarios)
    .where(eq(workforcePlanningScenarios.id, scenarioId))
    .limit(1);
  if (!scenario) return Response.json({ error: "Staffing scenario not found." }, { status: 404 });
  if (scenario.status !== "approved") {
    return Response.json({ error: "Only an approved staffing scenario can be published as the headcount baseline." }, { status: 409 });
  }
  if (!scenario.planId) {
    return Response.json({ error: "The approved scenario must be linked to a workforce plan before publication." }, { status: 409 });
  }
  if (scenario.scopeOrgUnitId != null || scenario.worksiteId != null) {
    return Response.json({
      error: "Only a company-wide scenario can publish the official workforce-plan baseline. Keep scoped scenarios as what-if planning evidence.",
    }, { status: 409 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    scenario.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only company-wide People administrators can publish a workforce-plan baseline.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, scenario.organizationId);
  if (!access?.companyWide) {
    return Response.json({ error: "Publishing the official headcount baseline requires company-wide access." }, { status: 403 });
  }

  if (hash(scenario.snapshot) !== scenario.snapshotHash) {
    return Response.json({ error: "The approved scenario snapshot no longer matches its recorded evidence hash." }, { status: 409 });
  }

  const [[plan], positionRows, assignmentRows] = await Promise.all([
    db.select().from(workforcePlans).where(and(
      eq(workforcePlans.id, scenario.planId),
      eq(workforcePlans.organizationId, scenario.organizationId),
    )).limit(1),
    db.select().from(positions).where(eq(positions.organizationId, scenario.organizationId)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, scenario.organizationId)),
  ]);
  if (!plan) return Response.json({ error: "Linked workforce plan not found." }, { status: 404 });

  const asOf = todayPh();
  const headcount = summarizeHeadcountPlan({
    planId: plan.id,
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
  const forecast = extractForecastSummary(scenario.snapshot);

  const [latest] = await db.select({ version: workforcePlanBaselines.version })
    .from(workforcePlanBaselines)
    .where(eq(workforcePlanBaselines.planId, plan.id))
    .orderBy(desc(workforcePlanBaselines.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  const publishedAt = new Date();
  const snapshot = {
    version: "hcm-headcount-baseline-v1",
    publishedAt: publishedAt.toISOString(),
    asOf,
    plan: {
      id: plan.id,
      name: plan.name,
      startDate: String(plan.startDate),
      endDate: String(plan.endDate),
      budget: Number(plan.budget),
    },
    scenario: {
      id: scenario.id,
      name: scenario.name,
      version: scenario.version,
      snapshotHash: scenario.snapshotHash,
      startDate: String(scenario.startDate),
      endDate: String(scenario.endDate),
      demandGrowthPercent: Number(scenario.demandGrowthPercent),
      vacancyFillPercent: Number(scenario.vacancyFillPercent),
      employerLoadPercent: Number(scenario.employerLoadPercent),
    },
    scope: {
      orgUnitId: null,
      worksiteId: null,
      scopeLabel: "Company",
    },
    headcount,
    forecast,
    boundary: "This immutable baseline records approved workforce-plan evidence at publication. Live position, assignment, requisition, payroll, and scheduling records continue to change independently and are reconciled as actuals.",
  };
  const snapshotHash = hash(snapshot);

  try {
    const baseline = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workforce_plans where id = ${plan.id} for update`);

      const [existing] = await tx.select().from(workforcePlanBaselines).where(and(
        eq(workforcePlanBaselines.organizationId, scenario.organizationId),
        eq(workforcePlanBaselines.scenarioId, scenario.id),
      )).limit(1);
      if (existing) throw new Error("SCENARIO_ALREADY_PUBLISHED");

      await tx.update(workforcePlanBaselines).set({
        current: false,
        supersededAt: publishedAt,
      }).where(and(
        eq(workforcePlanBaselines.organizationId, scenario.organizationId),
        eq(workforcePlanBaselines.planId, plan.id),
        eq(workforcePlanBaselines.current, true),
      ));

      const [created] = await tx.insert(workforcePlanBaselines).values({
        organizationId: scenario.organizationId,
        planId: plan.id,
        scenarioId: scenario.id,
        version,
        scopeOrgUnitId: null,
        worksiteId: null,
        current: true,
        snapshot,
        snapshotHash,
        publishedByUserId: user.id,
        publishedBy: user.name,
        publishedAt,
      }).returning();

      await tx.update(workforcePlans).set({
        status: "published",
        updatedAt: publishedAt,
      }).where(eq(workforcePlans.id, plan.id));

      return created;
    });

    await recordAuditEvent({
      organizationId: scenario.organizationId,
      actor: user.name,
      action: "Workforce plan baseline published",
      resource: `${plan.name} v${version}`,
      metadata: {
        baselineId: baseline.id,
        planId: plan.id,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        scenarioSnapshotHash: scenario.snapshotHash,
        snapshotHash,
        requestedHeadcount: headcount.requestedHeadcount,
        approvedHeadcount: headcount.approvedHeadcount,
        filledHeadcount: headcount.filledHeadcount,
        filledFte: headcount.filledFte,
      },
    });

    return Response.json({ baseline }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SCENARIO_ALREADY_PUBLISHED") {
      return Response.json({ error: "This approved scenario has already been published as a plan baseline." }, { status: 409 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "The headcount baseline could not be published." }, { status: 409 });
  }
}
