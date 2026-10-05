import { assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { buildLaborInspectionEvidencePackForOrganization } from "@/lib/labor-inspection-evidence-pack-server";
import {
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const INSPECTION_EXPORT_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll", "checker"] as const;

function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    INSPECTION_EXPORT_ROLES,
    "Only company-wide People, Payroll, Checker, Bookkeeper, Admin or Owner roles can export inspection evidence.",
  );
  if (denied) return denied;

  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "The labor inspection evidence pack is company-wide and is not available to unit-scoped roles.",
    }, { status: 403 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "labor-inspection-evidence-export",
    resourceId: organizationId,
    limit: 6,
    windowMs: 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let pack;
  try {
    pack = await buildLaborInspectionEvidencePackForOrganization({
      organizationId,
      generatedBy: user.name,
      today: manilaToday(),
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The inspection evidence pack could not be generated.",
    }, { status: 422 });
  }

  const rowCounts = Object.fromEntries(
    Object.entries(pack.sections).map(([name, section]) => [name, section.rowCount]),
  );

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Labor inspection evidence pack exported",
    resource: pack.range.label,
    metadata: {
      snapshotSha256: pack.snapshot.sha256,
      sectionHashes: pack.snapshot.sectionHashes,
      rowCounts,
      schemaVersion: pack.schemaVersion,
      range: pack.range,
      sensitiveDataExcluded: true,
      certificationClaimed: false,
    },
  });

  const filename = `labor-inspection-evidence-${organizationId}-${pack.range.endDate}.json`;
  return new Response(JSON.stringify(pack, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-PayrollPH-Evidence-SHA256": pack.snapshot.sha256,
      "X-PayrollPH-Evidence-Version": pack.schemaVersion,
    },
  });
}
