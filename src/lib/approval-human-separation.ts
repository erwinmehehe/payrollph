/**
 * Secondary release critical maker-checker identity gate.
 * Delegations affect the routing target, NEVER the distinct-human requirement.
 */
export function payrollMakerCheckerDecision(input: {
  makerUserId: unknown;
  checkerUserId: number;
  declaredApproverUserId?: number | null;
  namedApproverUsed?: boolean;
}): {ok:true}|{ok:false;code:"missing_maker"|"same_human"|"missing_assignee"|"different_assignee"} {
  // Audit metadata must contain a real numeric identity. Number(true)=1 and
  // Number("1")=1 are not acceptable maker/checker proofs.
  const maker=input.makerUserId;
  const checker=input.checkerUserId;
  if(typeof maker!=="number"||!Number.isSafeInteger(maker)||maker<1
    ||!Number.isSafeInteger(checker)||checker<1)
    return {ok:false,code:"missing_maker"};
  if(maker===checker)return {ok:false,code:"same_human"};
  if(input.namedApproverUsed){
    // A named checker needs an actual authenticated, audit-bound assignee.
    // A missing assignment must never mean "any distinct checker is allowed".
    // Delegates are evaluated separately by the authoritative routing guard.
    const assignee=input.declaredApproverUserId;
    if(assignee==null||!Number.isSafeInteger(assignee)||assignee<1)
      return {ok:false,code:"missing_assignee"};
    if(assignee!==checker)return {ok:false,code:"different_assignee"};
  }
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
