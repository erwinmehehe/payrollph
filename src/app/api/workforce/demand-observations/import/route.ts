import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { parseDemandImport, operationalDemandPilotAllowed } from "@/lib/workforce-operational-demand-import";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import { DemandImportConflict, writeOperationalDemandImport } from "@/lib/workforce-operational-demand-server";

export const dynamic = "force-dynamic";

/** Browser-authenticated import for *aggregated* completed workload intervals. */
export async function POST(request: Request) {
  const deniedOrigin = enforceSameOriginMutation(request);
  if (deniedOrigin) return deniedOrigin;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  // Content-length is only an early filter; actual parsed size is checked too.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 65536) {
    return Response.json({ error: "Aggregate import request is too large." }, { status: 413 });
  }
  const raw = await request.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > 65536) {
    return Response.json({ error: "Aggregate import request is too large." }, { status: 413 });
  }
  let batch;
  try {
    batch = parseDemandImport(JSON.parse(raw));
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Invalid aggregate demand import.",
    }, { status: 400 });
  }
  if (!operationalDemandPilotAllowed(batch.organizationId)) {
    return Response.json({ error: "Operational demand import is not available for this employer." }, { status: 404 });
  }
  const access = await getAccess(user.id, batch.organizationId);
  if (!access || !access.companyWide ||
    !PEOPLE_ADMIN_ROLES.some(role => role === access.role)) {
    return Response.json({ error: "Company-wide People admin access is required." }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const limitDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "wfm-operational-demand-import",
    resourceId: batch.organizationId, limit: 12, windowMs: 5 * 60_000,
  });
  if (limitDenied) return limitDenied;

  try {
    const [site] = await db.select({
      organizationId: worksites.organizationId,
      orgUnitId: worksites.orgUnitId, active: worksites.active,
    }).from(worksites).where(and(
      eq(worksites.organizationId, batch.organizationId),
      eq(worksites.id, batch.worksiteId),
    )).limit(1);
    if (!site || !operationalDemandSiteAuthorized(access, site)) {
      return Response.json({ error: "Worksite unavailable in the selected employer." }, { status: 403 });
    }
    const result = await writeOperationalDemandImport({
      batch, actorUserId: user.id, actorName: user.name,
    });
    return Response.json({
      ...result,
      boundary: "Imported as source-reported aggregate counts, not independently verified demand. " +
        "Nothing was posted to payroll, employee records or scheduling.",
    }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DemandImportConflict) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Operational demand storage is unavailable or not yet migrated." }, { status: 503 });
  }
}
