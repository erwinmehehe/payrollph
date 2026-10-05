import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { laborInspectionRemediations } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { buildLaborInspectionReadiness } from "@/lib/labor-inspection-readiness-server";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const DENIED = "Only company-wide People, Payroll, Checker, Bookkeeper, Admin or Owner roles can manage labor inspection readiness.";

async function requireAccess(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(userId, organizationId, PEOPLE_PAYROLL_ROLES, DENIED);
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Labor inspection readiness is company-wide and is not available to unit-scoped roles.",
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

  const readiness = await buildLaborInspectionReadiness(organizationId);
  return Response.json(readiness, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Managing labor inspection remediation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();
  const findingKey = String(body.findingKey ?? "").trim();
  if (!Number.isInteger(organizationId) || organizationId <= 0 || findingKey.length < 3 || findingKey.length > 220) {
    return Response.json({ error: "organizationId and findingKey are required." }, { status: 400 });
  }

  const denied = await requireAccess(user.id, organizationId);
  if (denied) return denied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `labor-inspection-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const readiness = await buildLaborInspectionReadiness(organizationId);
  const finding = readiness.findings.find((row) => row.key === findingKey) ?? null;
  const [existing] = await db.select().from(laborInspectionRemediations)
    .where(and(
      eq(laborInspectionRemediations.organizationId, organizationId),
      eq(laborInspectionRemediations.findingKey, findingKey),
    ))
    .limit(1);

  if (action === "assign" || action === "acknowledge") {
    if (!finding) {
      return Response.json({
        error: "The finding is no longer active. Refresh inspection readiness before assigning it.",
      }, { status: 409 });
    }
    const owner = String(body.owner ?? finding.defaultOwner).trim().slice(0, 120);
    if (owner.length < 2) return Response.json({ error: "A remediation owner is required." }, { status: 400 });

    const values = {
      ruleCode: finding.ruleCode,
      status: action === "acknowledge" ? "acknowledged" : (existing?.status === "acknowledged" ? "acknowledged" : "open"),
      owner,
      acknowledgedBy: action === "acknowledge" ? user.name : existing?.acknowledgedBy ?? null,
      acknowledgedAt: action === "acknowledge" ? new Date() : existing?.acknowledgedAt ?? null,
      resolutionNote: null,
      evidenceReference: null,
      resolvedBy: null,
      resolvedAt: null,
      updatedAt: new Date(),
    } as const;

    const [record] = existing
      ? await db.update(laborInspectionRemediations).set(values)
          .where(eq(laborInspectionRemediations.id, existing.id)).returning()
      : await db.insert(laborInspectionRemediations).values({
          organizationId,
          findingKey,
          ...values,
        }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: action === "acknowledge" ? "Labor inspection finding acknowledged" : "Labor inspection remediation owner assigned",
      resource: finding.title,
      metadata: {
        findingKey,
        ruleCode: finding.ruleCode,
        owner,
        snapshotHash: finding.snapshotHash,
        exposureAmount: finding.exposureAmount,
        exposureConfidence: finding.exposureConfidence,
      },
    });
    return Response.json({ remediation: record });
  }

  if (action === "close") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    if (finding) {
      return Response.json({
        error: "This finding is still detected in current PayrollPH evidence. Fix the underlying issue and refresh before closing it.",
      }, { status: 409 });
    }
    if (!existing) {
      return Response.json({ error: "Track or acknowledge the finding before closing it." }, { status: 404 });
    }
    if (existing.status === "resolved") {
      return Response.json({ remediation: existing });
    }

    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 2000);
    const evidenceReference = String(body.evidenceReference ?? "").trim().slice(0, 240);
    if (resolutionNote.length < 8 || evidenceReference.length < 4) {
      return Response.json({
        error: "Close-out requires a resolution note and an evidence reference.",
      }, { status: 400 });
    }

    const [record] = await db.update(laborInspectionRemediations).set({
      status: "resolved",
      resolutionNote,
      evidenceReference,
      resolvedBy: user.name,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(laborInspectionRemediations.id, existing.id),
      eq(laborInspectionRemediations.organizationId, organizationId),
    )).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Labor inspection finding closed",
      resource: existing.ruleCode,
      metadata: {
        findingKey,
        ruleCode: existing.ruleCode,
        owner: existing.owner,
        resolutionNote,
        evidenceReference,
        verification: "finding-no-longer-detected",
      },
    });

    return Response.json({ remediation: record });
  }

  return Response.json({
    error: "Unsupported action. Use assign, acknowledge, or close.",
  }, { status: 400 });
}
