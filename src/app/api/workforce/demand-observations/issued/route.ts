import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import { validReceiptId } from "@/lib/workforce-schedule-receipt";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import {
  issuedDemandPilotAllowed, parseIssueDemandRequest,
} from "@/lib/workforce-issued-demand-validation";
import {
  DemandEvidenceConflict, fetchIssuedDemandForecasts, issueOperationalDemandForecast,
} from "@/lib/workforce-issued-demand-server";

export const dynamic = "force-dynamic";

async function scopedWorksite(organizationId: number, worksiteId: number,
  access: { organizationId: number; companyWide: boolean; orgUnitId: number | null }) {
  const [site] = await db.select({
    organizationId: worksites.organizationId, orgUnitId: worksites.orgUnitId,
    active: worksites.active, timezone: worksites.timezone,
  }).from(worksites).where(and(
    eq(worksites.organizationId, organizationId), eq(worksites.id, worksiteId),
  )).limit(1);
  return !!site && operationalDemandSiteAuthorized(access, site)
    && site.timezone === "Asia/Manila";
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const p = new URL(request.url).searchParams;
  const organizationId = Number(p.get("organizationId") ?? "");
  const worksiteId = Number(p.get("worksiteId") ?? "");
  if (!validReceiptId(organizationId) || !validReceiptId(worksiteId)) {
    return Response.json({ error: "Valid employer and worksite required." }, { status: 400 });
  }
  // Authorize the active employer, session policy and deny-only custom
  // workforce permission BEFORE disclosing any tenant pilot configuration.
  const roleDenied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "Workforce manager access is required.",
  );
  if (roleDenied) return roleDenied;
  const access = await getAccess(user.id, organizationId);
  if (!access) {
    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  }
  if (!issuedDemandPilotAllowed(organizationId)) {
    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });
  }
  try {
    if (!await scopedWorksite(organizationId, worksiteId, access)) {
      return Response.json({ error: "Worksite unavailable in the current manager scope." }, { status: 403 });
    }
    const issued = await fetchIssuedDemandForecasts({ organizationId, worksiteId });
    return Response.json({ readOnly: true, scope: { organizationId, worksiteId }, issued }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Issued forecasts are unavailable or not yet migrated." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = enforceSameOriginMutation(request);
  if (denied) return denied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const raw = await request.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > 4096) {
    return Response.json({ error: "Forecast issue request is too large." }, { status: 413 });
  }
  let input;
  try { input = parseIssueDemandRequest(JSON.parse(raw)); }
  catch { return Response.json({ error: "Invalid aggregate forecast issue request." }, { status: 400 }); }
  if (!issuedDemandPilotAllowed(input.organizationId)) {
    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });
  }
  const access = await getAccess(user.id, input.organizationId);
  if (!access || !access.companyWide
    || !PEOPLE_ADMIN_ROLES.some(role => role === access.role)) {
    return Response.json({ error: "Company-wide People admin is required to issue workload forecasts." }, { status: 403 });
  }
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const limit = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "wfm-issued-demand-forecast", resourceId: input.organizationId,
    limit: 8, windowMs: 5 * 60_000,
  });
  if (limit) return limit;
  try {
    if (!await scopedWorksite(input.organizationId, input.worksiteId, access)) {
      return Response.json({ error: "Worksite unavailable in the selected employer." }, { status: 403 });
    }
    const record = await issueOperationalDemandForecast({
      request: input, actorUserId: user.id, actorName: user.name,
    });
    return Response.json({
      ...record, readOnlyForecast: true,
      boundary: "Issued aggregate workload estimates only. No worker schedule, wages or payroll were changed.",
    }, { status: record.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DemandEvidenceConflict) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: "Issued forecast storage is unavailable or not yet migrated." }, { status: 503 });
  }
}
