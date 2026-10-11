import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  DECISION_SOURCES, deriveManagerDecisionScope,
  type DecisionSource,
} from "@/lib/hcm-manager-decision-contract";
import {
  DecisionInboxScopeError, DecisionInboxSourceLimitError,
  loadManagerDecisionPage,
} from "@/lib/hcm-manager-decision-server";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };
function respond(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: noStore });
}
function positiveId(raw: string | null): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * GET only, default OFF. No approvals, decisions, files or employee writes.
 * A decision remains governed by the owning source route, not this inbox.
 */
export async function GET(request: Request) {
  if (process.env.HCM_MANAGER_DECISION_INBOX_ENABLED !== "true") {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const query = new URL(request.url).searchParams;
  const organizationId = positiveId(query.get("organizationId"));
  const rawCursor = query.get("beforeId");
  const before = rawCursor === null ? null : positiveId(rawCursor);
  const source = query.get("source") ?? "hcm";
  if (!organizationId || (rawCursor !== null && before === null) ||
      !DECISION_SOURCES.includes(source as DecisionSource)) {
    return respond({ error: "Valid employer, source and cursor are required." }, 400);
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "A workforce manager or HR role is required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  const scope = deriveManagerDecisionScope(access);
  if (!scope) return respond({
    error: "An authorized owner/HR role or assigned manager unit is required.",
  }, 403);

  try {
    return respond(await loadManagerDecisionPage({
      organizationId, userId: user.id, userName: user.name,
      viewerRole: access!.role, scope,
      source: source as DecisionSource, before,
    }));
  } catch (error) {
    if (error instanceof DecisionInboxScopeError) {
      return respond({ error: "Assigned organization-unit evidence is not valid." }, 403);
    }
    if (error instanceof DecisionInboxSourceLimitError) {
      return respond({ error: "Delegation evidence exceeds the bounded source limit." }, 409);
    }
    return respond({ error: "Manager decision source unavailable." }, 503);
  }
}
