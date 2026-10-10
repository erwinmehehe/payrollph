/** Minimal read-only monitor. No decision notes, names or mutable workflow actions. */
export type MonitorInstance = { id:number; processType:string; status:string; effectiveDate:string|null; initiatedAt:Date|string; currentStepIndex:number };
export type MonitorStep = { id:number; instanceId:number; stepIndex:number; stepType:string; status:string; dueAt:Date|string|null };
export function projectMonitor(instances:readonly MonitorInstance[],steps:readonly MonitorStep[],now:Date=new Date()){
 const eligible=new Set(instances.map(x=>x.id));
 const output=new Map<number,Array<{id:number;stepIndex:number;type:string;status:string;sla:"overdue"|"due"|"not_due"|"no_due_date"|"completed"}>>();
 for(const step of steps){
   if(!eligible.has(step.instanceId)) continue;
   const date=step.dueAt===null?null:new Date(step.dueAt);
   const valid=date!==null&&!Number.isNaN(date.getTime());
   const sla=step.status!=="pending"?"completed":!valid?"no_due_date":date!.getTime()<now.getTime()?"overdue":date!.getTime()===now.getTime()?"due":"not_due";
   const list=output.get(step.instanceId)||[];
   list.push({id:step.id,stepIndex:step.stepIndex,type:step.stepType,status:step.status,sla});output.set(step.instanceId,list);
 }
 return instances.map(x=>({id:x.id,processType:x.processType,status:x.status,effectiveDate:x.effectiveDate,initiatedAt:x.initiatedAt,
 currentStepIndex:x.currentStepIndex,steps:(output.get(x.id)||[]).sort((a,b)=>a.stepIndex-b.stepIndex||a.id-b.id)}));
}
