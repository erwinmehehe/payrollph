import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  payrollEntries,
  payrollRuns,
  statutoryRemittanceMonthClosures,
} from "@/db/schema";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { evaluateRemittanceMonthClose } from "@/lib/statutory-remittance-close";
import {
  currentManilaMonth,
  loadStatutoryRemittanceState,
  statutoryLiabilityKeys,
} from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function requirePayrollOperator(userId: number, organizationId: number) {
  return assertOrganizationRole(
    userId,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only authorized payroll operators can certify statutory remittance month close.",
  );
}

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

async function loadCloseState(organizationId: number, applicableMonth: string) {
  const state = await loadStatutoryRemittanceState(organizationId);
  if (!state) return null;

  const monthRuns = await db.select({
    id: payrollRuns.id,
    status: payrollRuns.status,
    periodEnd: payrollRuns.periodEnd,
  }).from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    gte(payrollRuns.periodEnd, monthStart(applicableMonth)),
    lte(payrollRuns.periodEnd, monthEnd(applicableMonth)),
  ));

  const runIds = monthRuns.map((run) => run.id);
  const entries = runIds.length
    ? await db.select({
        payrollRunId: payrollEntries.payrollRunId,
        employeeId: payrollEntries.employeeId,
        lineItems: payrollEntries.lineItems,
        trace: payrollEntries.trace,
      }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds))
    : [];
  const runMonths = Object.fromEntries(
    monthRuns.map((run) => [run.id, applicableMonth]),
  ) as Record<number, string>;
  const requiredAgencies = [...statutoryLiabilityKeys({ runMonths, entries })]
    .map((key) => key.split("|")[1])
    .filter(Boolean)
    .sort();

  const evaluation = evaluateRemittanceMonthClose({
    applicableMonth,
    batches: state.batches,
    members: state.members,
    alerts: state.alerts,
    requiredAgencies,
    allPayrollRunsReleased:
      monthRuns.length > 0 && monthRuns.every((run) => run.status === "Released"),
  });

  const [closure] = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
    ))
    .limit(1);

  const certificationValid = Boolean(
    closure
    && closure.status === "certified"
    && closure.snapshotHash === evaluation.snapshotHash
    && evaluation.ready,
  );

  return {
    evaluation,
    closure: closure ?? null,
    certificationValid,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const applicableMonth = String(url.searchParams.get("applicableMonth") ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const result = await loadCloseState(organizationId, applicableMonth);
  if (!result) return Response.json({ error: "Organization not found." }, { status: 404 });
  return Response.json(result);
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const applicableMonth = String(body.applicableMonth ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-remittance-month-close",
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (applicableMonth >= currentManilaMonth()) {
    return Response.json({
      error: "Only a fully closed prior payroll month can be certified.",
    }, { status: 409 });
  }

  const current = await loadCloseState(organizationId, applicableMonth);
  if (!current) return Response.json({ error: "Organization not found." }, { status: 404 });
  if (!current.evaluation.ready) {
    return Response.json({
      error: "This remittance month is not ready to certify.",
      blockers: current.evaluation.blockers,
    }, { status: 409 });
  }

  const now = new Date();
  const [existing] = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
    ))
    .limit(1);

  let closure;
  if (existing) {
    [closure] = await db.update(statutoryRemittanceMonthClosures).set({
      status: "certified",
      snapshotHash: current.evaluation.snapshotHash,
      certifiedByUserId: user.id,
      certifiedByName: user.name,
      certifiedAt: now,
      invalidatedAt: null,
      invalidationReason: null,
      updatedAt: now,
    }).where(and(
      eq(statutoryRemittanceMonthClosures.id, existing.id),
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
    )).returning();
  } else {
    [closure] = await db.insert(statutoryRemittanceMonthClosures).values({
      organizationId,
      applicableMonth,
      status: "certified",
      snapshotHash: current.evaluation.snapshotHash,
      certifiedByUserId: user.id,
      certifiedByName: user.name,
      certifiedAt: now,
    }).returning();
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Statutory remittance month certified",
    resource: applicableMonth,
    metadata: {
      closureId: closure.id,
      applicableMonth,
      snapshotHash: current.evaluation.snapshotHash,
      agencyCount: current.evaluation.agencyCount,
      memberCount: current.evaluation.memberCount,
    },
  });

  return Response.json({
    closure,
    certificationValid: true,
    evaluation: current.evaluation,
  });
}
