import { and, asc, eq, gt, ne } from "drizzle-orm";
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
 let cursor=0;
 let raised=0;
 // Page through eligible pending steps. A large cohort must not block all work.
 for (;;) {
 const rows=await db.select({
   id:approvalChainInstanceSteps.id,
   instanceId:approvalChainInstances.id,
   organizationId:approvalChainInstances.organizationId,
   stepIndex:approvalChainInstanceSteps.stepIndex,
   stepCreatedAt:approvalChainInstances.createdAt,
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
   eq(approvalChainInstances.currentStepIndex,approvalChainInstanceSteps.stepIndex),
   eq(approvalTasks.status,"Pending"),
   ne(approvalTasks.priority,"High"),
   gt(approvalChainInstanceSteps.id,cursor),
 )).orderBy(asc(approvalChainInstanceSteps.id)).limit(250);
 if(!rows.length)break;
 cursor=rows[rows.length-1].id;
 for(const row of rows){
   const snapshot=Array.isArray(row.stepsSnapshot)?row.stepsSnapshot:[];
   const step=snapshot[row.stepIndex] as {escalationAfterDays?:number}|undefined;
   if(step?.escalationAfterDays==null)continue;
   // Serialize against stage advancement and decision writes before mutating the task.
   const changed=await db.transaction(async (tx)=>{
     const [instance]=await tx.select({
       status:approvalChainInstances.status,
       currentStepIndex:approvalChainInstances.currentStepIndex,
       createdAt:approvalChainInstances.createdAt,
     }).from(approvalChainInstances).where(and(
       eq(approvalChainInstances.id,row.instanceId),
       eq(approvalChainInstances.organizationId,row.organizationId),
     )).for("update").limit(1);
     if(!instance || instance.status!=="pending" || instance.currentStepIndex!==row.stepIndex)return false;
     const [activeStep]=await tx.select({
       id:approvalChainInstanceSteps.id,status:approvalChainInstanceSteps.status,
       approvalTaskId:approvalChainInstanceSteps.approvalTaskId,
     }).from(approvalChainInstanceSteps).where(and(
       eq(approvalChainInstanceSteps.id,row.id),
       eq(approvalChainInstanceSteps.instanceId,row.instanceId),
       eq(approvalChainInstanceSteps.organizationId,row.organizationId),
     )).for("update").limit(1);
     if(!activeStep || activeStep.status!=="pending" || activeStep.approvalTaskId!==row.taskId)return false;
     // The preceding approved step activates stage >0; creation time would over-age it.
     let activatedAt=instance.createdAt;
     if(row.stepIndex>0){
       const [previous]=await tx.select({
         status:approvalChainInstanceSteps.status,
         decidedAt:approvalChainInstanceSteps.decidedAt,
       }).from(approvalChainInstanceSteps).where(and(
         eq(approvalChainInstanceSteps.instanceId,row.instanceId),
         eq(approvalChainInstanceSteps.organizationId,row.organizationId),
         eq(approvalChainInstanceSteps.stepIndex,row.stepIndex-1),
       )).limit(1);
       if(!previous || previous.status!=="approved" || !previous.decidedAt)return false;
       activatedAt=previous.decidedAt;
     }
     if(!shouldEscalateApprovalStep({
       createdAt:activatedAt,now,days:step?.escalationAfterDays,
       taskStatus:row.taskStatus,stepStatus:activeStep.status,priority:row.priority,
     }))return false;
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
         stepIndex:row.stepIndex,escalationAfterDays:step?.escalationAfterDays,
         stageActivatedAt:activatedAt.toISOString()},
     });
     return true;
   });
   if(!changed)continue;
   raised++;
 }
 if(rows.length<250)break;
 }
 return {skipped:false as const,raised};
}
