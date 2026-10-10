import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import {
  InvalidTeamAttendanceScopeError,
  TeamAttendanceSourceOverflowError,
  loadTeamAttendancePreview,
} from "@/lib/hcm-team-attendance-preview-server";

export const dynamic = "force-dynamic";
function respond(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
function positiveId(value: string | null, allowZero = false): number | null {
  if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && (allowZero ? id >= 0 : id > 0) ? id : null;
}

/** No approval, attendance or payroll writes, and OFF unless explicitly enabled in the server runtime. */
export async function GET(request: Request) {
  if (process.env.HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED !== "true") {
    return respond({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveId(params.get("organizationId"));
  const cursor = params.has("cursor") ? positiveId(params.get("cursor"), true) : 0;
  if (organizationId === null || cursor === null) {
    return respond({ error: "Invalid employer or cursor." }, 400);
  }

  const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES);
  if (denied) return denied;
  const scope = deriveMyTeamScope(await getAccess(user.id, organizationId));
  if (!scope) {
    return respond({ error: "An authorized current HR scope or concrete manager unit is required." }, 403);
  }

  try {
    return respond(await loadTeamAttendancePreview({ organizationId, scope, cursor }));
  } catch (error) {
    if (error instanceof InvalidTeamAttendanceScopeError) {
      return respond({ error: "Supervisory unit evidence missing, inactive or not effective." }, 403);
    }
    if (error instanceof TeamAttendanceSourceOverflowError) {
      return respond({ error: "Too many source punch records for a safe bounded preview." }, 409);
    }
    return respond({ error: "Attendance or schedule evidence unavailable; no coverage conclusion." }, 503);
  }
}
