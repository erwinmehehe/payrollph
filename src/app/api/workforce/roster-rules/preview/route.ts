import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, shiftDefinitions, worksites, workforceScheduleGuardrailPolicies } from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { employeeSiteEligibility } from "@/lib/hcm-worksite-eligibility-server";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { DEFAULT_SCHEDULE_GUARDRAIL_POLICY, evaluateScheduleGuardrails } from "@/lib/workforce-schedule-guardrails";
import { rosterDateOffset } from "@/lib/workforce-team-roster";
import { decideRosterRulePublish } from "@/lib/workforce-roster-rules";
import { checkWfmRosterPublish, wfmRosterScaleRulesEnabled } from "@/lib/workforce-roster-rules-server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!wfmRosterScaleRulesEnabled())return Response.json({error:"Not found."},{status:404});
  const deniedOrigin=enforceSameOriginMutation(request);if(deniedOrigin)return deniedOrigin;
  const user=await getSessionUser();if(!user)return Response.json({error:"Unauthorized."},{status:401});
  const body=await request.json().catch(()=>({}));
  const organizationId=Number(body.organizationId),employeeId=Number(body.employeeId);
  const workDate=String(body.workDate??""),kind=String(body.kind??"");
  if(!Number.isSafeInteger(organizationId)||organizationId<=0||!Number.isSafeInteger(employeeId)||employeeId<=0
    ||!["shift","rest_day"].includes(kind)){
    return Response.json({error:"Valid employer, employee and shift/rest-day kind required."},{status:400});
  }
  try{rosterDateOffset(workDate,0);}catch{return Response.json({error:"Invalid calendar work date."},{status:400});}
  const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"People administrator required.");
  if(denied)return denied;
  const access=await getAccess(user.id,organizationId);
  const [worker]=await db.select({orgUnitId:employees.orgUnitId}).from(employees)
    .where(and(eq(employees.organizationId,organizationId),eq(employees.id,employeeId))).limit(1);
  if(!worker||!assertScope(access,worker.orgUnitId).ok)return Response.json({error:"Employee outside authorized scope."},{status:403});
  const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
  const limited=await enforceSensitiveActionRateLimit(request,{userId:user.id,action:"wfm-roster-rules-preview",resourceId:organizationId,limit:30,windowMs:5*60_000});
  if(limited)return limited;
  const shiftId=Number(body.shiftDefinitionId),worksiteId=body.worksiteId==null?null:Number(body.worksiteId);
  if(kind==="shift"&&(!Number.isSafeInteger(shiftId)||shiftId<=0))return Response.json({error:"Select a shift to preview."},{status:400});
  if(worksiteId!==null&&(!Number.isSafeInteger(worksiteId)||worksiteId<=0))return Response.json({error:"Invalid worksite."},{status:400});
  if(worksiteId!==null){
    const [site]=await db.select({id:worksites.id,orgUnitId:worksites.orgUnitId,active:worksites.active})
      .from(worksites).where(and(eq(worksites.organizationId,organizationId),eq(worksites.id,worksiteId))).limit(1);
    if(!site||!site.active||!assertScope(access,site.orgUnitId).ok)return Response.json({error:"Worksite unavailable."},{status:403});
    const eligibility=await employeeSiteEligibility({organizationId,employeeId,worksiteId,date:workDate});
    if(!eligibility.eligible)return Response.json({error:"Worksite eligibility must be reviewed before preview."},{status:409});
  }
  if(kind==="shift"){
    const [shift]=await db.select({id:shiftDefinitions.id}).from(shiftDefinitions)
      .where(and(eq(shiftDefinitions.organizationId,organizationId),eq(shiftDefinitions.id,shiftId),eq(shiftDefinitions.active,true))).limit(1);
    if(!shift)return Response.json({error:"Shift is not active in this employer."},{status:404});
  }
  try{
    const days=await resolveEmployeeScheduleWindow({
      organizationId,employeeId,startDate:rosterDateOffset(workDate,-7),endDate:rosterDateOffset(workDate,7),
      prospectiveOverride:{
        id:Number.MAX_SAFE_INTEGER,workDate,
        kind:kind as "shift"|"rest_day",isRestDay:kind==="rest_day",
        segments:kind==="shift"?[{shiftDefinitionId:shiftId,segmentOrder:1}]:[],
        worksiteId,status:"approved",reason:"Draft roster rule preview",
      },
    });
    const [check,legacyRow]=await Promise.all([
      checkWfmRosterPublish({organizationId,employeeId,days,targetDates:[workDate]}),
      db.select().from(workforceScheduleGuardrailPolicies).where(eq(workforceScheduleGuardrailPolicies.organizationId,organizationId)).limit(1),
    ]);
    const original=legacyRow[0];
    const legacy=original?{
      minimumRestMinutes:original.minimumRestMinutes,maxConsecutiveWorkingDays:original.maxConsecutiveWorkingDays,
      rollingSevenDayMinutes:original.rollingSevenDayMinutes,active:original.active,
      enforcementMode:original.enforcementMode==="block"?"block" as const:"advisory" as const,
    }:DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
    const guardrailIssues=evaluateScheduleGuardrails({days,policy:legacy});
    const decision=decideRosterRulePublish({findings:check.findings,overrideReason:String(body.ruleOverrideReason??""),
      managerMayOverride:["owner","admin","hr","manager"].includes(access?.role??"")});
    return Response.json({ruleFindings:check.findings,guardrailIssues,blocked:decision.blocked||
      guardrailIssues.some(issue=>issue.blocking),canOverrideCodes:decision.overriddenCodes,
      policy:check.policy,message:"Preview only. No shift, payroll entry or approval was created."},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Current scheduling evidence could not be verified; no change was made."},{status:409});}
}
