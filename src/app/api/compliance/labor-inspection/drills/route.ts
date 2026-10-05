import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { laborInspectionDrills } from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { buildInspectionDrill } from "@/lib/labor-inspection-drill";
import { buildLaborInspectionEvidencePackForOrganization } from "@/lib/labor-inspection-evidence-pack-server";
import { buildLaborInspectionReadiness } from "@/lib/labor-inspection-readiness-server";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DRILL_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function requireAccess(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    DRILL_ROLES,
    "Only company-wide People, Payroll, Checker, Bookkeeper, Admin or Owner roles can run inspection drills.",
  );
  if (denied) return denied;

  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Labor inspection drills are company-wide and are not available to unit-scoped roles.",
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requireAccess(user.id, organizationId);
  if (denied) return denied;

  const rows = await db.select().from(laborInspectionDrills)
    .where(eq(laborInspectionDrills.organizationId, organizationId))
    .orderBy(desc(laborInspectionDrills.createdAt), desc(laborInspectionDrills.id))
    .limit(12);

  return Response.json({
    drills: rows.map((row) => ({
      id: row.id,
      status: row.status,
      rangeLabel: row.rangeLabel,
      evidencePackSha256: row.evidencePackSha256,
      evidencePackVersion: row.evidencePackVersion,
      snapshotSha256: row.snapshotSha256,
      summary: {
        high: row.highFindings,
        medium: row.mediumFindings,
        info: row.infoFindings,
        recordedExposure: Number(row.recordedExposure),
        screeningExposure: Number(row.screeningExposure),
        unownedActionable: row.unownedActionable,
        readyToClose: row.readyToClose,
      },
      blockers: row.blockerSummary,
      actionPlan: row.actionPlan,
      sectionRowCounts: row.sectionRowCounts,
      generatedBy: row.generatedBy,
      createdAt: row.createdAt,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Running labor inspection drills");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const denied = await requireAccess(user.id, organizationId);
  if (denied) return denied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "labor-inspection-drill",
    resourceId: organizationId,
    limit: 6,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const today = manilaToday();
  const [readiness, pack] = await Promise.all([
    buildLaborInspectionReadiness(organizationId, { today }),
    buildLaborInspectionEvidencePackForOrganization({
      organizationId,
      generatedBy: user.name,
      today,
    }),
  ]);

  const sectionRowCounts = Object.fromEntries(
    Object.entries(pack.sections).map(([name, section]) => [name, section.rowCount]),
  );

  const drill = buildInspectionDrill({
    evidencePackSha256: pack.snapshot.sha256,
    schemaVersion: pack.schemaVersion,
    rangeLabel: pack.range.label,
    findings: readiness.findings.map((finding) => ({
      key: finding.key,
      ruleCode: finding.ruleCode,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      employeeNo: finding.employeeNo ?? null,
      periodLabel: finding.periodLabel ?? null,
      exposureAmount: finding.exposureAmount,
      exposureConfidence: finding.exposureConfidence,
      remediation: finding.remediation
        ? { owner: finding.remediation.owner, status: finding.remediation.status }
        : null,
      defaultOwner: finding.defaultOwner,
    })),
    readyToCloseCount: readiness.remediation.readyToClose.length,
    sectionRowCounts,
  });

  const [row] = await db.insert(laborInspectionDrills).values({
    organizationId,
    status: drill.status,
    rangeLabel: drill.rangeLabel,
    evidencePackSha256: drill.evidencePackSha256,
    evidencePackVersion: drill.evidencePackVersion,
    snapshotSha256: drill.snapshotSha256,
    highFindings: drill.summary.high,
    mediumFindings: drill.summary.medium,
    infoFindings: drill.summary.info,
    recordedExposure: String(drill.summary.recordedExposure),
    screeningExposure: String(drill.summary.screeningExposure),
    unownedActionable: drill.summary.unownedActionable,
    readyToClose: drill.summary.readyToClose,
    blockerSummary: drill.blockers,
    actionPlan: drill.actionPlan,
    sectionRowCounts: drill.sectionRowCounts,
    generatedBy: user.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Labor inspection drill completed",
    resource: drill.rangeLabel,
    metadata: {
      drillId: row.id,
      status: drill.status,
      snapshotSha256: drill.snapshotSha256,
      evidencePackSha256: drill.evidencePackSha256,
      evidencePackVersion: drill.evidencePackVersion,
      summary: drill.summary,
      certificationClaimed: false,
    },
  });

  return Response.json({
    drill: {
      id: row.id,
      ...drill,
      generatedBy: user.name,
      createdAt: row.createdAt,
    },
  }, { status: 201 });
}
