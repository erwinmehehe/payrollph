import { cookies } from "next/headers";
import { pool } from "@/db";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { GET as scheduleGet } from "@/app/api/workforce/schedules/route";
import { GET as attendanceGet } from "@/app/api/workforce/attendance-exceptions/route";
import { GET as floorGet } from "@/app/api/workforce/live-floor/route";
import { GET as selfGet } from "@/app/api/self/workforce/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const HEADERS = {"Cache-Control":"no-store", "Vary":"Cookie"};
const REF = "qa/neon-repaired-preview-20261016";
type Check = { name:string; status:number; pass:boolean };

async function withQAUser(
  suffix:string,
  work:(id:number, workerId:number|null)=>Promise<Check[]>,
): Promise<Check[]> {
  const email = "qa-acceptance-" + suffix + "@example.invalid";
  const {rows} = await pool.query(
    "SELECT id,employee_id FROM public.users WHERE email=$1 AND active AND local_password_enabled=false",
    [email]
  );
  if(rows.length !== 1) return [{name:suffix+"-fixture",status:0,pass:false}];
  const id=Number(rows[0].id), workerId=rows[0].employee_id==null?null:Number(rows[0].employee_id);
  const {token}=await createSession(id,{userAgent:"QA schedule acceptance 20261016"},{mfaVerifiedAt:new Date()});
  const jar=await cookies();
  try {
    jar.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:"lax",path:"/"});
    return await work(id,workerId);
  } finally {
    try { jar.delete(SESSION_COOKIE); } catch { /* cleanup continues */ }
    await pool.query("DELETE FROM public.sessions WHERE user_id=$1 AND token_hash=$2",[id,sha256(token)]);
  }
}
async function check(name:string, invoke:()=>Promise<Response>, statusExpected:number, accepts?:(obj:any)=>boolean):Promise<Check> {
  try {
    const resp=await invoke();
    let pass=resp.status===statusExpected;
    if(pass && statusExpected===200 && accepts) {
      const body=await resp.json().catch(()=>null);
      pass=!!body && accepts(body);
    }
    return {name,status:resp.status,pass};
  } catch { return {name,status:0,pass:false}; }
}

export async function GET() {
  if(process.env.VERCEL_ENV!=="preview" || process.env.VERCEL_GIT_COMMIT_REF!==REF)
    return Response.json({ok:false},{status:404,headers:HEADERS});
  const jar=await cookies();
  if(jar.get(SESSION_COOKIE) || jar.get("linaw_session"))
    return Response.json({ok:false},{status:403,headers:HEADERS});
  const target=await pool.query(
    "SELECT pg_catalog.current_database()='neondb' AND pg_catalog.current_setting('neon.project_id',true)='calm-wave-70219564' "+
    "AND pg_catalog.current_setting('neon.branch_id',true)='br-green-hat-b77qj8fs' "+
    "AND pg_catalog.current_setting('neon.endpoint_id',true)='ep-old-paper-b7k36yuc' AS ok"
  ).catch(()=>({rows:[{ok:false}]}));
  if(target.rows[0]?.ok!==true) return Response.json({ok:false},{status:503,headers:HEADERS});
  const claimed=await pool.query(
    "UPDATE public.qa_scheduling_20261016_gate SET armed=false,used_at=now() "+
    "WHERE gate_id=1 AND armed=true AND used_at IS NULL AND expires_at>now() RETURNING gate_id"
  ).catch(()=>({rows:[]}));
  if(claimed.rows.length!==1) return Response.json({ok:false},{status:404,headers:HEADERS});
  const workers=await pool.query(
    "SELECT id,employee_no FROM public.employees WHERE organization_id=2 AND employee_no IN ('QA-20261016-A','QA-20261016-B')"
  );
  const ids=new Map(workers.rows.map((x:any)=>[x.employee_no,Number(x.id)]));
  const a=ids.get("QA-20261016-A") as number, b=ids.get("QA-20261016-B") as number;
  const reports:Check[]=[];
  if(!a||!b) return Response.json({ok:false,checks:[{name:"workers",status:0,pass:false}]},{status:503,headers:HEADERS});
  const runHR=async(suffix:string,ownId:number,foreignUnitId:number,expectedLate:boolean)=>{
    const checks=await withQAUser(suffix,async()=>{
      const eId=String(ownId),p="/api/workforce/schedules?organizationId=2&employeeId="+eId+"&date=2026-10-15";
      const schedule=await check(suffix+"-schedule",()=>scheduleGet(new Request("https://qa.invalid"+p)),200,(x)=>
        Number(x.employee?.id)===ownId && x.resolved?.source==="pattern" && !x.resolved?.isRestDay
        && Array.isArray(x.resolved?.segments) && x.resolved.segments.length===1
        && x.resolved.segments[0].startTime.startsWith("09:00")
        && x.resolved.segments[0].endTime.startsWith("17:00")
      );
      const other=await check(suffix+"-other-unit-denied",()=>scheduleGet(
        new Request("https://qa.invalid/api/workforce/schedules?organizationId=2&employeeId="+foreignUnitId+"&date=2026-10-15")
      ),403);
      const attendance=await check(suffix+"-attendance",()=>attendanceGet(
        new Request("https://qa.invalid/api/workforce/attendance-exceptions?organizationId=2&startDate=2026-10-15&endDate=2026-10-15&includeAll=1")
      ),200,(x)=>{
        const days=x.days;
        if(!Array.isArray(days)||days.length!==1||Number(days[0]?.employee?.id)!==ownId)return false;
        const hasLate=Array.isArray(days[0]?.analysis?.exceptions)&&days[0].analysis.exceptions.some((ex:any)=>ex.kind==="late_arrival");
        return hasLate===expectedLate;
      });
      const floor=await check(suffix+"-live-floor",()=>floorGet(new Request(
        "https://qa.invalid/api/workforce/live-floor?organizationId=2"
      )),200,(x)=>Number(x.totalEmployees)===1 && Number(x.unresolvedSchedules)===0
        && Array.isArray(x.rows) && x.rows.every((r:any)=>Number(r.employeeId)===ownId));
      return [schedule,other,attendance,floor];
    });
    reports.push(...checks);
  };
  try{
    await runHR("org2-hr-a",a,b,false);
    await runHR("org2-hr-b",b,a,true);
    reports.push(...await withQAUser("org2-employee-b",async(_id,workerId)=>[
      await check("employee-b-self-punches",()=>selfGet(
        new Request("https://qa.invalid/api/self/workforce?startDate=2026-10-15&endDate=2026-10-16")
      ),200,(x)=>Number(x.employee?.id)===b && Number(workerId)===b
        && Array.isArray(x.punches) && x.punches.length===1
        && x.punches.every((p:any)=>p.status==="Complete")
        && !!x.schedule)
    ]));
  } catch { reports.push({name:"acceptance-internal",status:0,pass:false}); }
  const ok=reports.length===9 && reports.every(x=>x.pass);
  return Response.json({ok,checks:reports,evidenceScope:"QA_TEST_SESSIONS_REAL_ROUTE_GET_NO_BROWSER_AUTH"},{status:ok?200:503,headers:HEADERS});
}
