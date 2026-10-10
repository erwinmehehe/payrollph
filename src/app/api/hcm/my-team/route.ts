import { getSessionUser } from "@/lib/auth";
import { managerTeamPositiveId } from "@/lib/hcm-manager-team";
import { authorizeManagerTeam, loadManagerTeamPage } from "@/lib/hcm-manager-team-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

const json = (payload: unknown, status = 200) => Response.json(payload, { status, headers });

/** Read only. Authenticated manager identity is resolved from membership, never query params. */
export async function GET(request: Request) {
  if (process.env.HCM_MANAGER_TEAM_ENABLED !== "true") {
    return json({ error: "Not found." }, 404);
  }

  const user = await getSessionUser();
  if (!user) return json({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = managerTeamPositiveId(params.get("organizationId"));
  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : managerTeamPositiveId(rawCursor);
  if (!organizationId || (rawCursor !== null && cursor === null)) {
    return json({ error: "Valid organizationId and cursor are required." }, 400);
  }

  try {
    const scope = await authorizeManagerTeam(user.id, organizationId);
    if (!scope) return json({ error: "Manager team access is unavailable for this employer." }, 403);
    const page = await loadManagerTeamPage(scope, cursor);
    return json(page);
  } catch {
    // No SQL details, worker identifiers or partially fetched records on failure.
    return json({ error: "Current manager-team evidence is unavailable." }, 503);
  }
}
