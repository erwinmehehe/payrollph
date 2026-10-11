import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  currentPhilippineMonth, deriveTeamLeaveScope, isPermittedTeamLeaveMonth,
} from "@/lib/hcm-team-leave-calendar-contract";
import {
  loadTeamLeaveMonth, TeamLeaveInvalidMonthError, TeamLeaveScopeError,
  TeamLeaveSourceOverflowError,
} from "@/lib/hcm-team-leave-calendar-server";

export const dynamic = "force-dynamic";

function respond(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
function positiveId(raw: string | null): number | null {
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Default OFF. Monthly read-only leave case span snapshot; no decisions. */
export async function GET(request: Request) {
  if (process.env.HCM_TEAM_LEAVE_CALENDAR_ENABLED !== "true") {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveId(params.get("organizationId"));
  const now = new Date();
  const month = params.get("month") ?? currentPhilippineMonth(now);
  if (!organizationId || !isPermittedTeamLeaveMonth(month, now)) {
    return respond({ error: "Valid employer and current/upcoming month required." }, 400);
  }
  const denied = await assertOrganizationRole(
    user.id, organizationId, WORKFORCE_MANAGER_ROLES,
    "Workforce manager or People oversight access is required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  const scope = deriveTeamLeaveScope(access);
  if (!scope) {
    return respond({ error: "An assigned manager unit or authorized HR scope is required." }, 403);
  }

  try {
    return respond(await loadTeamLeaveMonth({ organizationId, scope, month, now }));
  } catch (error) {
    if (error instanceof TeamLeaveInvalidMonthError) {
      return respond({ error: "Month is outside the supported pilot window." }, 400);
    }
    if (error instanceof TeamLeaveScopeError) {
      return respond({ error: "Current organizational scope evidence is unavailable." }, 403);
    }
    if (error instanceof TeamLeaveSourceOverflowError) {
      return respond({ error: "Too many requests for a complete safe calendar month." }, 409);
    }
    return respond({ error: "The leave request source is unavailable." }, 503);
  }
}
