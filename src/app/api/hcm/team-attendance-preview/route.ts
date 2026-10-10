import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, timePunches } from "@/db/schema";
import { assertOrganizationRole, getAccess, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { deriveMyTeamScope } from "@/lib/hcm-my-team-contract";
import { loadResolvedEmployeeSchedule } from "@/lib/workforce-schedule-evidence-server";
import { classifyTeamAttendance, summarizeTeamAttendance } from "@/lib/hcm-team-attendance-preview";

export const dynamic = "force-dynamic";
const respond = (payload: unknown, status = 200) => Response.json(payload, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const id = (value: string | null, zero = false) => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && (zero ? n >= 0 : n > 0) ? n : null;
};
const phDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

/** Current PH business day only. No writes, no leave-hour or attendance certification. */
export async function GET(request: Request) {
  if (process.env.HCM_TEAM_ATTENDANCE_PREVIEW_ENABLED !== "true") return respond({ error: "Not found." }, 404);
  const user = await getSessionUser();
  if (!user) return respond({ error: "Authentication required." }, 401);
  const params = new URL(request.url).searchParams;
  const organizationId = id(params.get("organizationId"));
  const cursor = params.has("cursor") ? id(params.get("cursor"), true) : 0;
  if (organizationId === null || cursor === null) return respond({ error: "Invalid employer or cursor." }, 400);
  const denied = await assertOrganizationRole(user.id, organizationId, WORKFORCE_MANAGER_ROLES);
  if (denied) return denied;
  const scope = deriveMyTeamScope(await getAccess(user.id, organizationId));
  if (!scope) return respond({ error: "Concrete active supervisory unit or HR scope required." }, 403);
  const date = phDate();
  if (scope.kind === "unit") {
    const [unit] = await db.select({ id: orgUnits.id }).from(orgUnits).where(and(
      eq(orgUnits.organizationId, organizationId), eq(orgUnits.id, scope.orgUnitId),
      eq(orgUnits.active, true),
    )).limit(1);
    if (!unit) return respond({ error: "Inactive or foreign supervisory unit." }, 403);
  }
  const clauses = [eq(employees.organizationId, organizationId), gt(employees.id, cursor)];
  if (scope.kind === "unit") clauses.push(eq(employees.orgUnitId, scope.orgUnitId));
  try {
    // Small SQL page prevents an unbounded query of all company employees.
    const candidates = await db.select({
      id: employees.id, firstName: employees.firstName, lastName: employees.lastName,
    }).from(employees).where(and(...clauses)).orderBy(asc(employees.id)).limit(11);
    const page = candidates.slice(0, 10);
    const ids = page.map(row => row.id);
    const punches = ids.length ? await db.select({
      employeeId: timePunches.employeeId, timeIn: timePunches.timeIn, timeOut: timePunches.timeOut,
    }).from(timePunches).where(and(
      eq(timePunches.organizationId, organizationId),
      inArray(timePunches.employeeId, ids), eq(timePunches.workDate, date),
    )).limit(501) : [];
    // Refuse partial punch evidence rather than displaying a misleading absence.
    if (punches.length > 500) return respond({ error: "Punch evidence exceeds safe preview bound." }, 409);
    const rows = [];
    for (const employee of page) {
      const { schedule } = await loadResolvedEmployeeSchedule({
        organizationId, employeeId: employee.id, workDate: date,
      });
      rows.push(classifyTeamAttendance({
        employeeId: employee.id,
        name: (employee.firstName + " " + employee.lastName).trim(),
        workDate: date, schedule,
        punches: punches.filter(p => p.employeeId === employee.id),
      }));
    }
    return respond({
      organizationId, workDate: date, observedAt: new Date().toISOString(), scope,
      rows, summary: summarizeTeamAttendance(rows),
      page: { size: 10, hasMore: candidates.length > 10,
        nextCursor: candidates.length > 10 ? page[page.length - 1].id : null },
      warning: "Advisory: scheduled segments and recorded punches only. No source-certified absence, staffing demand, shift gap, payroll hours, or site coverage conclusion. Counts are page-local.",
    });
  } catch {
    return respond({ error: "Attendance or schedule evidence unavailable; no coverage conclusion." }, 503);
  }
}
