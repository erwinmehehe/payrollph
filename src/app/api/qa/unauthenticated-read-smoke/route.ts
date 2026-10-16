import { cookies } from "next/headers";
import { GET as compensationGet } from "@/app/api/compensation/route";
import { GET as attendanceEventsGet } from "@/app/api/workforce/attendance-exception-events/route";
import { GET as liveFloorGet } from "@/app/api/workforce/live-floor/route";
import { GET as payrollRunsGet } from "@/app/api/payroll-runs/route";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

/**
 * QA-only, read-only acceptance of the real route handlers' anonymous boundary.
 * No valid session cookie is accepted: never create, revoke or refresh sessions.
 * Runs only on the isolated Git/Vercel preview branch; do not merge into main.
 * Response contains boolean outcomes, never employee details, salaries or secrets.
 */
export async function GET() {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "qa/neon-repaired-preview-20261016"
  ) {
    return Response.json({ ok: false }, { status: 404, headers: HEADERS });
  }

  const jar = await cookies();
  if (jar.get("__Host-linaw_session") || jar.get("linaw_session")) {
    return Response.json({ ok: false }, { status: 403, headers: HEADERS });
  }

  const calls: ReadonlyArray<[string, () => Promise<Response>]> = [
    ["compensation", () => compensationGet(new Request("https://qa.invalid/api/compensation?organizationId=1"))],
    ["attendance", () => attendanceEventsGet(new Request("https://qa.invalid/api/workforce/attendance-exception-events?organizationId=1&startDate=2026-10-01&endDate=2026-10-16"))],
    ["liveFloor", () => liveFloorGet(new Request("https://qa.invalid/api/workforce/live-floor?organizationId=1"))],
    ["payroll", () => payrollRunsGet(new Request("https://qa.invalid/api/payroll-runs?organizationId=1"))],
  ];
  const checks: Record<string, boolean> = {};
  for (const [key, invoke] of calls) {
    try {
      const response = await invoke();
      checks[key] = response.status === 401;
    } catch {
      checks[key] = false;
    }
  }

  const ok = Object.values(checks).length === 4 && Object.values(checks).every(Boolean);
  return Response.json({ ok, anonymousAccessDenied: checks }, {
    status: ok ? 200 : 503,
    headers: HEADERS,
  });
}
