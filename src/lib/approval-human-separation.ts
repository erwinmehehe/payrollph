/**
 * Secondary release critical maker-checker identity gate.
 * Delegations affect the routing target, NEVER the distinct-human requirement.
 */
export function payrollMakerCheckerDecision(input: {
  makerUserId: unknown;
  checkerUserId: number;
  declaredApproverUserId?: number | null;
  namedApproverUsed?: boolean;
}): {ok:true}|{ok:false;code:"missing_maker"|"same_human"|"different_assignee"} {
  const maker=Number(input.makerUserId);
  const checker=input.checkerUserId;
  if(!Number.isSafeInteger(maker)||maker<1||!Number.isSafeInteger(checker)||checker<1)
    return {ok:false,code:"missing_maker"};
  if(maker===checker)return {ok:false,code:"same_human"};
  if(input.namedApproverUsed&&input.declaredApproverUserId!=null&&
    input.declaredApproverUserId!==checker)
    return {ok:false,code:"different_assignee"};
  return {ok:true};
}

export function shouldEscalateApprovalStep(input:{
  createdAt:Date;now:Date;days:number|null|undefined;
  taskStatus:string;stepStatus:string;priority:string;
}){
  if(input.days==null||!Number.isSafeInteger(input.days)||input.days<1||input.days>30
    ||input.taskStatus!=="Pending"||input.stepStatus!=="pending"
    ||input.priority==="High"
    ||!Number.isFinite(input.createdAt.getTime())
    ||!Number.isFinite(input.now.getTime()))return false;
  return input.now.getTime()-input.createdAt.getTime()>=input.days*86_400_000;
}
