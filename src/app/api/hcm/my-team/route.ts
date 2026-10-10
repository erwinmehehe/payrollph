import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveMyTeamScope, MY_TEAM_STATUSES, type MyTeamStatusFilter } from "@/lib/hcm-my-team-contract";
import { InvalidMyTeamScopeError, loadHcmMyTeam } from "@/lib/hcm-my-team-server";

export const dynamic = "force-dynamic";

function respond(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
function parseId(raw: string | null, allowZero = false): number | null {
  if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
    ? value : null;
}

/**
 * The manager workspace is strictly read-only. Explicit tenant membership,
 * workforce permission, concrete manager unit and server-side scope all
 * precede the SQL reads. Finance/bookkeeper roles are intentionally excluded.
 */
export async function GET(request: Request) {
  if (process.env.HCM_MY_TEAM_ENABLED !== "true") {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = parseId(params.get("organizationId"));
  const cursor = params.has("cursor") ? parseId(params.get("cursor"), true) : 0;
  const query = (params.get("q") ?? "").trim();
  const status = params.get("status") ?? "all";
  if (organizationId === null || cursor === null || query.length > 70 ||
      !MY_TEAM_STATUSES.includes(status as MyTeamStatusFilter)) {
    return respond({ error: "Invalid team query." }, 400);
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "Workforce manager authorization required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  const scope = deriveMyTeamScope(access);
  if (!scope) return respond({
    error: "An assigned supervisory unit or company-wide HR role is required.",
  }, 403);

  try {
    return respond(await loadHcmMyTeam({
      organizationId, scope, cursor, query,
      statusFilter: status as MyTeamStatusFilter,
    }));
  } catch (error) {
    if (error instanceof InvalidMyTeamScopeError) {
      return respond({ error: "Supervisory unit evidence is missing or inactive." }, 403);
    }
    return respond({ error: "My Team source unavailable." }, 503);
  }
}
