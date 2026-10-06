import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workforcePlanningScenarios,
  workforcePlans,
} from "@/db/schema";
import {
  getAccess,
  PEOPLE_PAYROLL_ROLES,
  WORKFORCE_MANAGER_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  loadScopedWorkforceForecast,
  redactWorkforceForecastCosts,
} from "@/lib/workforce-forecast-server";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const APPROVER_ROLES = new Set(["owner", "admin", "hr", "manager"]);
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

  const rows = await db.select().from(workforcePlanningScenarios)
    .where(eq(workforcePlanningScenarios.organizationId, organizationId))
    .orderBy(desc(workforcePlanningScenarios.createdAt), desc(workforcePlanningScenarios.id));

  return Response.json({
    scenarios: rows
      .filter((row) => scenarioVisibleToAccess(row, access))
      .map((row) => ({
        ...row,
        snapshot: canViewCost ? row.snapshot : redactScenarioSnapshot(row.snapshot),
      })),
    costVisible: canViewCost,
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
  const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 500) || null;
  if (!Number.isInteger(scenarioId) || scenarioId <= 0 || !["submit", "approve", "reject"].includes(action)) {
    return Response.json({ error: "Valid scenarioId and action are required." }, { status: 400 });
  }

  const [scenario] = await db.select().from(workforcePlanningScenarios)
    .where(eq(workforcePlanningScenarios.id, scenarioId))
    .limit(1);
  if (!scenario) return Response.json({ error: "Staffing scenario not found." }, { status: 404 });

  const access = await workforceAccess(user.id, scenario.organizationId);
  if (!access || !scenarioVisibleToAccess(scenario, access)) {
    return Response.json({ error: "This staffing scenario is outside your workforce scope." }, { status: 403 });
  }

  if (action === "submit") {
    if (scenario.status !== "draft") {
      return Response.json({ error: "Only draft scenarios can be submitted." }, { status: 409 });
    }
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx.update(workforcePlanningScenarios).set({
        status: "submitted",
        submittedByUserId: user.id,
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(workforcePlanningScenarios.id, scenarioId),
        eq(workforcePlanningScenarios.status, "draft"),
      )).returning();
      if (!row) throw new Error("Scenario changed before submission. Refresh and retry.");
      if (row.planId) {
        await tx.update(workforcePlans)
          .set({ status: "submitted", updatedAt: new Date() })
          .where(eq(workforcePlans.id, row.planId));
      }
      return [row];
    });

    await recordAuditEvent({
      organizationId: scenario.organizationId,
      actor: user.name,
      action: "Workforce staffing scenario submitted",
      resource: `${scenario.name} v${scenario.version}`,
      metadata: { scenarioId, snapshotHash: scenario.snapshotHash },
    });
    return Response.json({ scenario: updated });
  }

  if (!APPROVER_ROLES.has(access.role)) {
    return Response.json({ error: "Manager, HR, owner or admin approval is required." }, { status: 403 });
  }
  if (scenario.status !== "submitted") {
    return Response.json({ error: "Only submitted scenarios can be approved or rejected." }, { status: 409 });
  }
  if (scenario.submittedByUserId === user.id) {
    return Response.json({
      error: "Maker-checker control: the submitter cannot approve or reject their own staffing scenario.",
    }, { status: 409 });
  }

  const nextStatus = action === "approve" ? "approved" : "rejected";
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(workforcePlanningScenarios).set({
      status: nextStatus,
      decidedByUserId: user.id,
      decidedAt: new Date(),
      decisionNote,
      updatedAt: new Date(),
    }).where(and(
      eq(workforcePlanningScenarios.id, scenarioId),
      eq(workforcePlanningScenarios.status, "submitted"),
    )).returning();
    if (!row) throw new Error("Scenario changed before decision. Refresh and retry.");

    if (row.planId) {
      await tx.update(workforcePlans)
        .set({
          status: nextStatus === "approved" ? "approved" : "rejected",
          updatedAt: new Date(),
        })
        .where(eq(workforcePlans.id, row.planId));
    }
    return [row];
  });

  await recordAuditEvent({
    organizationId: scenario.organizationId,
    actor: user.name,
    action: action === "approve"
      ? "Workforce staffing scenario approved"
      : "Workforce staffing scenario rejected",
    resource: `${scenario.name} v${scenario.version}`,
    metadata: {
      scenarioId,
      snapshotHash: scenario.snapshotHash,
      submittedByUserId: scenario.submittedByUserId,
      decidedByUserId: user.id,
      decisionNote,
    },
  });

  return Response.json({ scenario: updated });
}
