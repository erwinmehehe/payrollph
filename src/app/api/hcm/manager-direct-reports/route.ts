import { getSessionUser } from "@/lib/auth";
import { canonicalManagerTeamId, managerDirectReportsEnabledForEmployer } from "@/lib/hcm-manager-direct-reports";
import {
  loadManagerDirectReports, ManagerDirectReportsAccessError,
  ManagerDirectReportsQueryError,
} from "@/lib/hcm-manager-direct-reports-server";

export const dynamic = "force-dynamic";

function respond(data: unknown, status = 200) {
  return Response.json(data, {
    status, headers: { "Cache-Control": "private, no-store" },
  });
}

/** This route cannot approve, change, or pay anyone. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const organizationId = canonicalManagerTeamId(params.get("organizationId"));
  if (!organizationId || !managerDirectReportsEnabledForEmployer(organizationId)) {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);
  const cursor = params.has("cursor")
    ? canonicalManagerTeamId(params.get("cursor"), true) : 0;
  if (cursor === null) return respond({ error: "Invalid page cursor." }, 400);
  try {
    // Loader independently enforces session policy, manager-only role,
    // workforce.manage custom deny and the employer-bound employee link.
    return respond(await loadManagerDirectReports({
      userId: user.id, organizationId, cursor,
    }));
  } catch (error) {
    if (error instanceof ManagerDirectReportsAccessError) {
      return respond({ error: "Manager direct-report access denied." }, 403);
    }
    if (error instanceof ManagerDirectReportsQueryError) {
      return respond({ error: "Invalid direct-report request." }, 400);
    }
    return respond({ error: "Direct-report source temporarily unavailable." }, 503);
  }
}
