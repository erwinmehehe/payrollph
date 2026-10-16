import { cookies } from "next/headers";
import { pool } from "@/db";
import { createSession, getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { getAccess } from "@/lib/access";
import { GET as compensationGet } from "@/app/api/compensation/route";
import { GET as attendanceGet } from "@/app/api/workforce/attendance-exception-events/route";
import { GET as floorGet } from "@/app/api/workforce/live-floor/route";
import { GET as payrollGet } from "@/app/api/payroll-runs/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const QA_REF = "qa/neon-repaired-preview-20261016";
const FIXTURE_PREFIX = "qa-acceptance-";
const PERSONAS = {
  g1: ["org1-hr-mkt", "org2-owner"],
  g2: ["org2-hr-a", "org2-hr-b"],
  g3: ["org2-hr-company", "org2-payroll"],
  g4: ["org2-employee-a", "org2-employee-b"],
} as const;
type GroupName = keyof typeof PERSONAS;
type ReadGet = (request: Request) => Promise<Response>;

function groupName(value: string | null): value is GroupName {
  return value === "g1" || value === "g2" || value === "g3" || value === "g4";
}

async function scenario(persona: string): Promise<{
  persona: string;
  authenticated: boolean;
  scopedMembership: boolean;
  ownEmployeeLinked: boolean;
  ownEndpoints: Record<string, { status: number; pass: boolean }>;
  foreignEndpoints: Record<string, { status: number; pass: boolean }>;
  foreignPayrollRun: { status: number; pass: boolean } | null;
  pass: boolean;
}> {
  const email = FIXTURE_PREFIX + persona + "@example.invalid";
  const userResult = await pool.query(
    "SELECT id,role,employee_id FROM public.users WHERE email=$1 AND active=true AND local_password_enabled=false",
    [email],
  );
  if (userResult.rowCount !== 1) throw new Error("qa user not present");
  const user = userResult.rows[0] as { id: number; role: string; employee_id: number | null };
  const orgId = persona === "org1-hr-mkt" ? 1 : 2;
  const foreignId = orgId === 1 ? 2 : 1;
  const scopedCode = persona === "org1-hr-mkt" ? "MKT" :
    persona.endsWith("-hr-a") || persona.endsWith("-employee-a") ? "QA-A" :
    persona.endsWith("-hr-b") || persona.endsWith("-employee-b") ? "QA-B" : null;
  const unitResult = scopedCode
    ? await pool.query("SELECT id FROM public.org_units WHERE organization_id=$1 AND code=$2 AND active=true", [orgId, scopedCode])
    : null;
  if (scopedCode && unitResult?.rowCount !== 1) throw new Error("qa unit not present");
  const expectedUnitId = unitResult ? Number(unitResult.rows[0].id) : null;
  const expectedEmployees = await pool.query(
    "SELECT id FROM public.employees WHERE organization_id=$1 AND ($2::integer IS NULL OR org_unit_id=$2) ORDER BY id",
    [orgId, expectedUnitId],
  );
  const visibleEmployeeIds = expectedEmployees.rows.map((x: { id: number }) => x.id);
  const { token } = await createSession(user.id, { userAgent: "PayrollPH isolated QA smoke" }, { mfaVerifiedAt: new Date(), authMethod: "local" });
  const jar = await cookies();
  try {
    jar.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    const authenticated = await getSessionUser();
    const membership = await getAccess(user.id, orgId);
    const authOk = authenticated?.id === user.id && authenticated?.role === user.role;
    const scopeOk = !!membership
      && membership.organizationId === orgId
      && membership.role === user.role
      && membership.orgUnitId === expectedUnitId
      && membership.companyWide === (expectedUnitId === null);
    const ownEmployeeLinked = user.role !== "employee" ||
      (user.employee_id !== null
       && authenticated?.employeeId === user.employee_id
       && visibleEmployeeIds.includes(user.employee_id));

    async function run(
      handler: ReadGet,
      path: string,
      expectedStatus: number,
      responseKind?: "compensation" | "floor" | "attendance" | "payroll",
    ): Promise<{ status: number; pass: boolean }> {
      try {
        const resp = await handler(new Request("https://qa.invalid" + path));
        let pass = resp.status === expectedStatus;
        if (pass && expectedStatus === 200 && responseKind) {
          const payload: any = await resp.json().catch(() => null);
          if (!payload || typeof payload !== "object") pass = false;
          else if (responseKind === "compensation") {
            const rows = Array.isArray(payload.employees) ? payload.employees : null;
            const returnedIds = rows?.map((x: any) => Number(x.id)).sort((a: number, b: number) => a - b);
            pass = !!returnedIds
              && returnedIds.length === visibleEmployeeIds.length
              && returnedIds.every((id: number, i: number) => id === visibleEmployeeIds[i]);
          } else if (responseKind === "floor") {
            pass = Number(payload.totalEmployees) === visibleEmployeeIds.length
              && Array.isArray(payload.rows)
              && payload.rows.length === visibleEmployeeIds.length;
          } else if (responseKind === "attendance") {
            pass = Array.isArray(payload.exceptions)
              && payload.exceptions.every((x: any) => x.employeeId == null || visibleEmployeeIds.includes(Number(x.employeeId)));
          } else if (responseKind === "payroll") {
            pass = Array.isArray(payload.runs) && payload.runs.length === 0;
          }
        }
        return { status: resp.status, pass };
      } catch {
        return { status: 0, pass: false };
      }
    }

    const isOwner = user.role === "owner";
    const isHr = user.role === "hr";
    const isPayroll = user.role === "payroll";
    const ownPaths = {
      compensation: "/api/compensation?organizationId=" + orgId,
      attendance: "/api/workforce/attendance-exception-events?organizationId=" + orgId + "&startDate=2026-10-01&endDate=2026-10-16",
      liveFloor: "/api/workforce/live-floor?organizationId=" + orgId,
      payroll: "/api/payroll-runs?organizationId=" + orgId,
    };
    const otherPaths = {
      compensation: "/api/compensation?organizationId=" + foreignId,
      attendance: "/api/workforce/attendance-exception-events?organizationId=" + foreignId + "&startDate=2026-10-01&endDate=2026-10-16",
      liveFloor: "/api/workforce/live-floor?organizationId=" + foreignId,
      payroll: "/api/payroll-runs?organizationId=" + foreignId,
    };
    const ownEndpoints = {
      compensation: await run(compensationGet,ownPaths.compensation,isOwner||isHr?200:403,"compensation"),
      attendance: await run(attendanceGet,ownPaths.attendance,isOwner||isHr||isPayroll?200:403,"attendance"),
      liveFloor: await run(floorGet,ownPaths.liveFloor,isOwner||isHr?200:403,"floor"),
      payroll: await run(payrollGet,ownPaths.payroll,isOwner||isPayroll?200:403,"payroll"),
    };
    const foreignEndpoints = {
      compensation: await run(compensationGet,otherPaths.compensation,403),
      attendance: await run(attendanceGet,otherPaths.attendance,403),
      liveFloor: await run(floorGet,otherPaths.liveFloor,403),
      payroll: await run(payrollGet,otherPaths.payroll,403),
    };
    let foreignPayrollRun: { status: number; pass: boolean } | null = null;
    if (orgId === 2 && (isOwner || isPayroll)) {
      const originalRun = await pool.query("SELECT id FROM public.payroll_runs WHERE organization_id=1 ORDER BY id LIMIT 1");
      foreignPayrollRun = originalRun.rowCount === 1
        ? await run(payrollGet,"/api/payroll-runs?runId=" + originalRun.rows[0].id + "&include=entries",403)
        : { status: 0, pass: false };
    }
    const pass = !!authOk && scopeOk && ownEmployeeLinked
      && Object.values(ownEndpoints).every(x => x.pass)
      && Object.values(foreignEndpoints).every(x => x.pass)
      && (foreignPayrollRun?.pass ?? true);
    return { persona,authenticated:!!authOk,scopedMembership:scopeOk,ownEmployeeLinked,ownEndpoints,foreignEndpoints,foreignPayrollRun,pass };
  } finally {
    // Never export the generated cookie or retain any test session. A final
    // delete-cookie header supersedes the temporary in-request cookie.
    jar.delete(SESSION_COOKIE);
    await pool.query("DELETE FROM public.sessions WHERE user_id=$1 AND token_hash=$2", [user.id,sha256(token)]);
  }
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== QA_REF) {
    return Response.json({ ok:false }, {status:404,headers:HEADERS});
  }
  const url=new URL(request.url);
  const group=url.searchParams.get("group");
  if (!groupName(group)) return Response.json({ok:false},{status:404,headers:HEADERS});
  const jar=await cookies();
  if (jar.get(SESSION_COOKIE) || jar.get("linaw_session")) {
    return Response.json({ok:false},{status:403,headers:HEADERS});
  }

  // Run the exact same PostgreSQL session-target checks as QA /api/health
  // before any DB mutation, including the one-time test-grant claim.
  const target=await pool.query(
    "SELECT pg_catalog.current_database() = 'neondb' AND " +
    "pg_catalog.current_setting('neon.project_id',true) = 'calm-wave-70219564' AND " +
    "pg_catalog.current_setting('neon.branch_id',true) = 'br-green-hat-b77qj8fs' AND " +
    "pg_catalog.current_setting('neon.endpoint_id',true) = 'ep-old-paper-b7k36yuc' AS matched"
  ).catch(() => ({ rows:[{matched:false}] }));
  if (target.rows[0]?.matched !== true) return Response.json({ok:false},{status:503,headers:HEADERS});

  // Explicitly armed in the isolated Neon branch; consumed exactly once.
  const claimed=await pool.query(
    "UPDATE public.qa_acceptance_20261016_controls SET armed=false,consumed_at=now() " +
    "WHERE group_name=$1 AND armed=true AND expires_at>now() AND consumed_at IS NULL RETURNING group_name",
    [group],
  ).catch(() => ({ rowCount:0 }));
  if (claimed.rowCount !== 1) return Response.json({ok:false},{status:404,headers:HEADERS});
  const reports=[];
  for (const persona of PERSONAS[group]) {
    try {
      reports.push(await scenario(persona));
    } catch {
      reports.push({persona,pass:false,internalError:true});
    }
  }
  const ok=reports.every(x=>x.pass===true);
  return Response.json({ok,group,reports,evidenceScope:"TEMPORARY_IN_PROCESS_REAL_SESSION_AND_GET_HANDLER_QA_NOT_BROWSER_LOGIN"}, {
    status:ok?200:503,headers:HEADERS,
  });
}
