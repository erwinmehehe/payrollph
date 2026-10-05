import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollMonthClosures } from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { ensurePayrollMonthCloseSchema } from "@/lib/payroll-month-close-schema";
import { buildPayrollMonthCloseState } from "@/lib/payroll-month-close-server";
import { currentManilaMonth } from "@/lib/statutory-remittance-state";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["owner", "admin", "bookkeeper", "payroll", "checker"] as const;
const CERTIFY_ROLES = ["owner", "admin", "checker"] as const;

async function requireCompanyWide(
  userId: number,
  organizationId: number,
  roles: readonly string[],
  message: string,
) {
  const denied = await assertOrganizationRole(userId, organizationId, roles, message);
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Payroll month close is company-wide and is not available to unit-scoped roles.",
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  await ensurePayrollMonthCloseSchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const applicableMonth = String(url.searchParams.get("applicableMonth") ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requireCompanyWide(
    user.id,
    organizationId,
    VIEW_ROLES,
    "Only company-wide Payroll, Checker, Bookkeeper, Admin or Owner roles can view payroll month close.",
  );
  if (denied) return denied;

  const state = await buildPayrollMonthCloseState(organizationId, applicableMonth);
  return Response.json({
    ...state,
    canCertifyRole: CERTIFY_ROLES.includes(
      (await getAccess(user.id, organizationId))?.role as typeof CERTIFY_ROLES[number],
    ),
    certificationRole: "independent-reviewer",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await ensurePayrollMonthCloseSchema();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Certifying payroll month close");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const applicableMonth = String(body.applicableMonth ?? "").trim();
  if (!Number.isInteger(organizationId) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({ error: "organizationId and applicableMonth (YYYY-MM) are required." }, { status: 400 });
  }

  const denied = await requireCompanyWide(
    user.id,
    organizationId,
    CERTIFY_ROLES,
    "Only a company-wide Owner, Admin or Checker can independently certify payroll month close.",
  );
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "payroll-month-close-certification",
    resourceId: organizationId,
    limit: 12,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (applicableMonth >= currentManilaMonth()) {
    return Response.json({
      error: "Only a fully completed prior payroll month can be certified.",
    }, { status: 409 });
  }

  const current = await buildPayrollMonthCloseState(organizationId, applicableMonth);
  if (!current.evaluation.ready) {
    return Response.json({
      error: "This payroll month is not ready for independent certification.",
      blockers: current.evaluation.blockers,
    }, { status: 409 });
  }

  if (current.evidenceActors.includes(user.name)) {
    return Response.json({
      error: "The certifier participated in payout, journal, payroll close, BIR evidence, or remittance certification for this month. Use another Owner, Admin or Checker.",
      evidenceActors: current.evidenceActors,
    }, { status: 409 });
  }

  const [existingSnapshot] = await db.select().from(payrollMonthClosures)
    .where(and(
      eq(payrollMonthClosures.organizationId, organizationId),
      eq(payrollMonthClosures.applicableMonth, applicableMonth),
      eq(payrollMonthClosures.snapshotHash, current.evaluation.snapshotHash),
    ))
    .limit(1);

  const closure = existingSnapshot ?? (await db.insert(payrollMonthClosures).values({
    organizationId,
    applicableMonth,
    status: "certified",
    snapshotHash: current.evaluation.snapshotHash,
    evidenceSnapshot: current.evaluation.evidence,
    certifiedByUserId: user.id,
    certifiedByName: user.name,
    certifiedAt: new Date(),
  }).returning())[0];

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Payroll month close certified",
    resource: applicableMonth,
    metadata: {
      payrollMonthClosureId: closure.id,
      applicableMonth,
      snapshotHash: current.evaluation.snapshotHash,
      runCount: current.evaluation.runCount,
      bir1601cReference: current.bir1601c.agencyReference,
      remittanceSnapshotHash: current.remittance.snapshotHash,
      highInspectionFindingCount: current.inspection.highFindingCount,
      independentReview: true,
    },
  });

  return Response.json({
    closure,
    certificationValid: true,
    certificationHistoryPreserved: true,
    evaluation: current.evaluation,
  });
}
