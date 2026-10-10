import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps } from "@/db/schema";
import { projectMonitor } from "@/lib/hcm-bp-monitor-projection";
const PAGE_SIZE=30;
export async function loadMonitor(organizationId:number,beforeId:number|null) {
 const predicates=[eq(hcmBusinessProcessInstances.organizationId,organizationId)];
 if(beforeId!==null)predicates.push(lt(hcmBusinessProcessInstances.id,beforeId));
 const instances=await db.select({
   id:hcmBusinessProcessInstances.id,processType:hcmBusinessProcessInstances.processType,
   status:hcmBusinessProcessInstances.status,effectiveDate:hcmBusinessProcessInstances.effectiveDate,
   initiatedAt:hcmBusinessProcessInstances.initiatedAt,currentStepIndex:hcmBusinessProcessInstances.currentStepIndex,
 }).from(hcmBusinessProcessInstances).where(and(...predicates))
 .orderBy(desc(hcmBusinessProcessInstances.id)).limit(PAGE_SIZE+1);
 const visible=instances.slice(0,PAGE_SIZE);
 const ids=visible.map(x=>x.id);
 const steps=ids.length?await db.select({
   id:hcmBusinessProcessInstanceSteps.id,instanceId:hcmBusinessProcessInstanceSteps.instanceId,
   stepIndex:hcmBusinessProcessInstanceSteps.stepIndex,stepType:hcmBusinessProcessInstanceSteps.stepType,
   status:hcmBusinessProcessInstanceSteps.status,dueAt:hcmBusinessProcessInstanceSteps.dueAt,
 }).from(hcmBusinessProcessInstanceSteps).where(and(
   eq(hcmBusinessProcessInstanceSteps.organizationId,organizationId),
   inArray(hcmBusinessProcessInstanceSteps.instanceId,ids),
 )):[];
 return {tenantId:organizationId,items:projectMonitor(visible,steps),hasMore:instances.length>PAGE_SIZE,
 nextCursor:instances.length>PAGE_SIZE?visible[visible.length-1]?.id:null};
}
