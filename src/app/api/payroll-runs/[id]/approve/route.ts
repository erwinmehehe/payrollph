import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { assertPermission, getAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";

export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params; const runId=Number(id); if(!Number.isInteger(runId)) return Response.json({error:"Invalid run id."},{status:400});
  const user=await getSessionUser(); if(!user)return Response.json({error:"Authentication required."},{status:401});
  const [run]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,runId)).limit(1); if(!run)return Response.json({error:"Payroll run not found."},{status:404});
  const denied=await assertPermission(user.id,run.organizationId,"payroll:approve"); if(denied)return denied;
  if(!["Needs review","Ready for release","Processed","Approved"].includes(run.status)) return Response.json({error:"Calculate payroll before approval."},{status:409});
  const access=await getAccess(user.id,run.organizationId);
  const reviewStage=run.serviceMode==="managed"?"client_approved":"approved";
  const [updated]=await db.update(payrollRuns).set({status:"Approved",reviewStage,approvedByUserId:user.id,approvedAt:new Date()}).where(eq(payrollRuns.id,runId)).returning();
  await recordAuditEvent({organizationId:run.organizationId,actor:user.name,action:run.serviceMode==="managed"?"Managed payroll client-approved":"Payroll approved",resource:run.periodLabel,metadata:{runId,role:access?.role,ruleVersion:run.ruleVersion}});
  return Response.json({run:updated});
}
