import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orgUnits, organizations, payrollRuns } from "@/db/schema";
import { assertPermission, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { drainPayrollQueue, enqueuePayrollRun, getPayrollJobStatus } from "@/lib/payroll-engine";
import { payrollPeriodLabel, validatePayrollWindow } from "@/lib/payroll-period";

export const dynamic="force-dynamic";

export async function GET(request:Request){
 const user=await getSessionUser(); if(!user)return Response.json({error:"Authentication required."},{status:401});
 const {searchParams}=new URL(request.url); const organizationId=Number(searchParams.get("organizationId")??"0"); const runId=Number(searchParams.get("runId")??"0");
 if(runId>0){ const [target]=await db.select({organizationId:payrollRuns.organizationId}).from(payrollRuns).where(eq(payrollRuns.id,runId)).limit(1); if(!target)return Response.json({error:"Payroll run not found"},{status:404}); const denied=await assertPermission(user.id,target.organizationId,"payroll:read"); if(denied)return denied; return Response.json(await getPayrollJobStatus(runId)); }
 if(!Number.isInteger(organizationId)||organizationId<=0)return Response.json({error:"organizationId is required"},{status:400});
 const denied=await assertPermission(user.id,organizationId,"payroll:read"); if(denied)return denied;
 const runs=await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId,organizationId)).orderBy(desc(payrollRuns.id)); return Response.json({runs});
}

export async function POST(request:Request){
 const user=await getSessionUser(); if(!user)return Response.json({error:"Authentication required."},{status:401});
 const body=await request.json().catch(()=>({})); const organizationId=Number(body.organizationId); const periodStart=String(body.periodStart??""); const periodEnd=String(body.periodEnd??""); const payDate=String(body.payDate??""); const scopeOrgUnitId=body.scopeOrgUnitId==null||body.scopeOrgUnitId===""?null:Number(body.scopeOrgUnitId); const calculationMode=body.calculationMode==="timekeeping"?"timekeeping":"fixed_salary"; const processNow=body.processNow!==false;
 if(!Number.isInteger(organizationId)||organizationId<=0)return Response.json({error:"Valid organizationId is required."},{status:400});
 const window=validatePayrollWindow(periodStart,periodEnd,payDate); if(!window.ok)return Response.json({error:window.error},{status:400});
 const denied=await assertPermission(user.id,organizationId,"payroll:create"); if(denied)return denied;
 const access=await getAccess(user.id,organizationId); if(!access)return Response.json({error:"Workspace access required."},{status:403});
 let scopeLabel="All locations";
 if(scopeOrgUnitId!=null){ const [unit]=await db.select().from(orgUnits).where(eq(orgUnits.id,scopeOrgUnitId)).limit(1); if(!unit||unit.organizationId!==organizationId)return Response.json({error:"Payroll scope is not part of this organization."},{status:400}); if(!access.companyWide&&access.orgUnitId!==unit.id)return Response.json({error:"Payroll scope is outside your assigned unit."},{status:403}); scopeLabel=unit.name; }
 else if(!access.companyWide){ scopeLabel=access.orgUnitName??"Assigned unit"; }
 const effectiveScope=scopeOrgUnitId??(access.companyWide?null:access.orgUnitId);
 const [organization]=await db.select({payrollServiceMode:organizations.payrollServiceMode}).from(organizations).where(eq(organizations.id,organizationId)).limit(1); const serviceMode=organization?.payrollServiceMode==="managed"?"managed":"self_service";
 const periodLabel=payrollPeriodLabel(periodStart,periodEnd);
 const [run]=await db.insert(payrollRuns).values({organizationId,periodLabel,periodStart,periodEnd,payDate,scopeLabel,scopeOrgUnitId:effectiveScope,calculationMode,serviceMode,reviewStage:"preparation",status:"Draft",employeeCount:0,grossPay:"0",netPay:"0",exceptions:0,ruleVersion:"PH-2026.09"}).returning();
 await recordAuditEvent({organizationId,actor:user.name,action:"Payroll draft created",resource:periodLabel,metadata:{periodStart,periodEnd,payDate,scope:scopeLabel,calculationMode,serviceMode,ruleVersion:"PH-2026.09"}});
 let queue=null,processResult=null; if(processNow){ const processDenied=await assertPermission(user.id,organizationId,"payroll:process"); if(processDenied)return processDenied; queue=await enqueuePayrollRun(run.id); processResult=await drainPayrollQueue(20); }
 const [fresh]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,run.id)); return Response.json({run:fresh,queue,processResult},{status:201});
}
