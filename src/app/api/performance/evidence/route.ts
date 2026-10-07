import {
  assertOrganizationRole,
  getAccess,
  PEOPLE_ADMIN_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { buildPerformanceEvidencePackage } from "@/lib/hcm-performance-evidence";
import {
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = Number(url.searchParams.get("employeeId"));
  const cycleId = url.searchParams.get("cycleId") ? Number(url.searchParams.get("cycleId")) : null;
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }
  if (cycleId != null && !Number.isInteger(cycleId)) {
    return Response.json({ error: "cycleId must be a valid integer when provided." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can export performance evidence packages.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Performance evidence exports require company-wide People access.",
    }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "performance-evidence-export",
    resourceId: employeeId,
    limit: 8,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let pack;
  try {
    pack = await buildPerformanceEvidencePackage({
      organizationId,
      employeeId,
      cycleId,
      generatedBy: user.name,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The performance evidence package could not be generated.",
    }, { status: 422 });
  }

  const rowCounts = Object.fromEntries(
    Object.entries(pack.sections).map(([name, value]) => [name, value.rowCount]),
  );
  const selectedSealVerification = cycleId == null
    ? null
    : pack.sealVerification.find((item) => item.cycleId === cycleId) ?? null;

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Performance evidence package exported",
    resource: "Employee #" + employeeId,
    metadata: {
      employeeId,
      cycleId,
      schemaVersion: pack.schemaVersion,
      snapshotSha256: pack.snapshot.sha256,
      sectionHashes: pack.snapshot.sectionHashes,
      rowCounts,
      managerPrivateNotesExcluded: true,
      managerPrivateFeedbackExcluded: true,
      managerPrivateActionItemsExcluded: true,
      compensationAndPayrollExcluded: true,
      sealId: selectedSealVerification?.sealId ?? null,
      employeeEvidenceMatchesSeal: selectedSealVerification?.employeeEvidenceMatchesSeal ?? null,
      sealedManifestHash: selectedSealVerification?.manifestHash ?? null,
    },
  });

  const cycleLabel = cycleId == null ? "all-cycles" : "cycle-" + cycleId;
  const filename = "performance-evidence-" + employeeId + "-" + cycleLabel + ".json";
  return new Response(JSON.stringify(pack, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Linaw-Performance-Evidence-SHA256": pack.snapshot.sha256,
      "X-Linaw-Performance-Evidence-Version": pack.schemaVersion,
      ...(selectedSealVerification
        ? {
            "X-Linaw-Performance-Seal-ID": String(selectedSealVerification.sealId),
            "X-Linaw-Performance-Seal-Match": String(selectedSealVerification.employeeEvidenceMatchesSeal),
          }
        : {}),
    },
  });
}
