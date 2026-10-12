import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, approvalChainInstances, approvalChainInstanceSteps, auditEvents } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { shouldEscalateApprovalStep } from "@/lib/approval-human-separation";

/**
 * Advisory-only task priority escalation. Never approves a task, changes pay,
 * delegates an identity, or releases payroll automatically.
 */
export async function runDueApprovalChainEscalations(now=new Date()){
 if(!criticalReleaseFlagEnabled("approvalChainEscalations"))
   return {skipped:true as const,raised:0};
 const rows=await db.select({
   id:approvalChainInstanceSteps.id,
   instanceId:approvalChainInstances.id,
   organizationId:approvalChainInstances.organizationId,
   stepIndex:approvalChainInstanceSteps.stepIndex,
   stepCreatedAt:approvalChainInstanceSteps.createdAt,
   stepStatus:approvalChainInstanceSteps.status,
   taskId:approvalTasks.id,
   taskStatus:approvalTasks.status,
   priority:approvalTasks.priority,
   stepsSnapshot:approvalChainInstances.stepsSnapshot,
 }).from(approvalChainInstanceSteps)
 .innerJoin(approvalChainInstances,and(
   eq(approvalChainInstanceSteps.instanceId,approvalChainInstances.id),
   eq(approvalChainInstanceSteps.organizationId,approvalChainInstances.organizationId),
 ))
 .innerJoin(approvalTasks,and(
   eq(approvalChainInstanceSteps.approvalTaskId,approvalTasks.id),
   eq(approvalTasks.organizationId,approvalChainInstances.organizationId),
 ))
 .where(and(
   eq(approvalChainInstances.status,"pending"),
   eq(approvalChainInstanceSteps.status,"pending"),
   eq(approvalTasks.status,"Pending"),
 )).limit(251);
 if(rows.length>250)return {skipped:true as const,raised:0,reason:"cohort-too-large"};
 let raised=0;
 for(const row of rows){
   const snapshot=Array.isArray(row.stepsSnapshot)?row.stepsSnapshot:[];
   const step=snapshot[row.stepIndex] as {escalationAfterDays?:number}|undefined;
   if(!shouldEscalateApprovalStep({
    createdAt:row.stepCreatedAt,now,days:step?.escalationAfterDays,
    taskStatus:row.taskStatus,stepStatus:row.stepStatus,priority:row.priority,
   }))continue;
   // Conditional status recheck makes repeated leases/jobs idempotent.
   const changed=await db.transaction(async (tx)=>{
     const [updated]=await tx.update(approvalTasks).set({
       priority:"High",dueLabel:"Escalated: reviewer attention required",
     }).where(and(
       eq(approvalTasks.id,row.taskId),
       eq(approvalTasks.organizationId,row.organizationId),
       eq(approvalTasks.status,"Pending"),
       eq(approvalTasks.priority,row.priority),
     )).returning({id:approvalTasks.id});
     if(!updated)return false;
     // Audit and state transition commit atomically. If the append-only
     // receipt fails, the approval task remains unchanged.
     await tx.insert(auditEvents).values({
       organizationId:row.organizationId,actor:"System scheduler",
       action:"Approval chain overdue escalation",resource:"Approval task",
       metadata:{approvalTaskId:row.taskId,instanceId:row.instanceId,
         stepIndex:row.stepIndex,escalationAfterDays:step?.escalationAfterDays},
     });
     return true;
   });
   if(!changed)continue;
   raised++;
 }
 return {skipped:false as const,raised};
}
