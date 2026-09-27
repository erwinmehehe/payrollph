import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { assertPermission, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { queueMessage } from "@/lib/mailer";
import { releasePayrollRunAtomically } from "@/lib/payroll-release";
import { dispatchWebhook } from "@/lib/webhooks";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; const runId=Number(id); if(!Number.isInteger(runId))return Response.json({error:"Invalid run id."},{status:400});
 const user=await getSessionUser(); if(!user)return Response.json({error:"Authentication required."},{status:401});
 const [run]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,runId)).limit(1); if(!run)return Response.json({error:"Payroll run not found."},{status:404});
 const denied=await assertPermission(user.id,run.organizationId,"payroll:release"); if(denied)return denied;
 const access=await getAccess(user.id,run.organizationId); const body=await request.json().catch(()=>({}));
 try{
  const released=await releasePayrollRunAtomically({runId,userId:user.id,actorRole:access?.role??"",acknowledgeExceptions:body.acknowledgeExceptions===true});
  await recordAuditEvent({organizationId:run.organizationId,actor:user.name,action:"Payroll released",resource:run.periodLabel,metadata:{runId,ruleVersion:run.ruleVersion,exceptionsAcknowledged:run.exceptions>0?run.exceptions:0}});
  let notified=0,webhookDeliveries=0;
  if(!user.demo){
   const [organization]=await db.select().from(organizations).where(eq(organizations.id,run.organizationId));
   const included=await db.select({employeeId:payrollEntries.employeeId}).from(payrollEntries).where(eq(payrollEntries.payrollRunId,runId));
   const ids=[...new Set(included.map(r=>r.employeeId))]; const staff=ids.length?await db.select().from(employees).where(inArray(employees.id,ids)):[];
   for(const person of staff){ if(person.organizationId!==run.organizationId||person.status==="Separated"||!person.email)continue; notified++; await queueMessage({organizationId:run.organizationId,recipient:person.email,subject:`Your payslip for ${run.periodLabel} is ready`,purpose:"payslip-ready",body:[`Hi ${person.firstName},`,"",`${organization?.name??"Your employer"} released payroll for ${run.periodLabel}.`,"","Sign in to Linaw to view and download your payslip."].join("\n")}); }
   const deliveries=await dispatchWebhook({organizationId:run.organizationId,event:"payroll.released",data:{runId,period:run.periodLabel,payDate:run.payDate,employees:released.entryCount,grossPay:run.grossPay,netPay:run.netPay}}); webhookDeliveries=deliveries.length;
  }
  return Response.json({run:released.run,employeesNotified:notified,webhookDeliveries,demoSideEffectsSuppressed:user.demo});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Could not release payroll."},{status:409});}
}
