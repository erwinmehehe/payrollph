import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workforceDemandForecastIssues, worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import {
  issuedDemandPilotAllowed, parseScoreDemandRequest,
} from "@/lib/workforce-issued-demand-validation";
import {
  DemandEvidenceConflict, finalizeOperationalDemandScore,
} from "@/lib/workforce-issued-demand-server";

export const dynamic = "force-dynamic";

/** Irreversible one-time final score; no rescore/update/delete action exists. */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const raw = await request.text().catch(() => "");
  if (Buffer.byteLength(raw, "utf8") > 2048) {
    return Response.json({ error: "Final scoring request is too large." }, { status: 413 });
  }
  let input;
  try { input = parseScoreDemandRequest(JSON.parse(raw)); }
  catch { return Response.json({ error: "Invalid final scoring request." }, { status: 400 }); }
  if (!issuedDemandPilotAllowed(input.organizationId)) {
    return Response.json({ error: "Final scoring is unavailable for this employer." }, { status: 404 });
  }
  const access = await getAccess(user.id, input.organizationId);
  if (!access || !access.companyWide
    || !PEOPLE_ADMIN_ROLES.some(role => role === access.role)) {
    return Response.json({ error: "Company-wide People admin is required for final scoring." }, { status: 403 });
  }
  const mfa = requireSensitiveActionMfa(user);
  if (mfa) return mfa;
  const rate = await enforceSensitiveActionRateLimit(request, {
    userId: user.id, action: "wfm-demand-forecast-final-score",
    resourceId: input.organizationId, limit: 8, windowMs: 5 * 60_000,
  });
  if (rate) return rate;
  try {
    const [issue] = await db.select({
      id: workforceDemandForecastIssues.id,
      worksiteId: workforceDemandForecastIssues.worksiteId,
    }).from(workforceDemandForecastIssues).where(and(
      eq(workforceDemandForecastIssues.organizationId, input.organizationId),
      eq(workforceDemandForecastIssues.id, input.issueId),
    )).limit(1);
    if (!issue) return Response.json({ error: "Issued forecast unavailable in this employer." }, { status: 403 });
    const [site] = await db.select({
      organizationId: worksites.organizationId, orgUnitId: worksites.orgUnitId,
      active: worksites.active, timezone: worksites.timezone,
    }).from(worksites).where(and(
      eq(worksites.organizationId, input.organizationId),
      eq(worksites.id, issue.worksiteId),
    )).limit(1);
    if (!site || !operationalDemandSiteAuthorized(access, site)
      || site.timezone !== "Asia/Manila") {
      return Response.json({ error: "Worksite unavailable in the selected employer." }, { status: 403 });
    }
    const result = await finalizeOperationalDemandScore({
      organizationId: input.organizationId, issueId: input.issueId,
      actorUserId: user.id, actorName: user.name,
    });
    return Response.json({
      ...result, readOnlyScore: true,
      boundary: "Final source-reported workload score. No employee, schedule, payroll or payout decision.",
    }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DemandEvidenceConflict) {
      return Response.json({
        error: error.message,
        ...(error.missingCount ? { missingIntervals: error.missingCount } : {}),
      }, { status: 409 });
    }
    return Response.json({ error: "Final demand score storage is unavailable or not yet migrated." }, { status: 503 });
  }
}
