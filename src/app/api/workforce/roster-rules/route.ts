import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, workforceRosterRulePolicies } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { PH_ROSTER_RULE_DEFAULTS, validateRosterRulePolicy, type WfmRosterRulePolicy } from "@/lib/workforce-roster-rules";
import { loadWfmRosterRulePolicy, wfmRosterScaleRulesEnabled } from "@/lib/workforce-roster-rules-server";

export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store"};

export async function GET(request:Request) {
  if(!wfmRosterScaleRulesEnabled())return Response.json({error:"Not found."},{status:404});
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Unauthorized."},{status:401});
  const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
  if(!Number.isSafeInteger(organizationId)||organizationId<=0)return Response.json({error:"Valid employer required."},{status:400});
  const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"Only People administrators may review workforce policy.");
  if(denied)return denied;
  const [row]=await db.select({id:workforceRosterRulePolicies.id}).from(workforceRosterRulePolicies)
    .where(eq(workforceRosterRulePolicies.organizationId,organizationId)).limit(1);
  return Response.json({policy:await loadWfmRosterRulePolicy(organizationId),
    configured:Boolean(row),
    guidance:"Daily regular hours use PH Labor Code Articles 83/87. The 12h shift, 11h rest and 48h week are configurable employer controls, not universal statutory maximums. Premium values remain payroll-engine responsibility."},
    {headers:noStore});
}
export async function POST(request:Request) {
  if(!wfmRosterScaleRulesEnabled())return Response.json({error:"Not found."},{status:404});
  const origin=enforceSameOriginMutation(request);if(origin)return origin;
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Unauthorized."},{status:401});
  const body=await request.json().catch(()=>({}));
  const organizationId=Number(body.organizationId);
  const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"Only People administrators may change workforce policy.");
  if(denied)return denied;
  const access=await getAccess(user.id,organizationId);
  if(!access?.companyWide)return Response.json({error:"Company-wide workforce permission required."},{status:403});
  const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
  const rate=await enforceSensitiveActionRateLimit(request,{userId:user.id,action:"wfm-roster-policy",resourceId:organizationId,limit:15,windowMs:5*60_000});
  if(rate)return rate;
  const reason=String(body.reason??"").trim().slice(0,240);
  if(body.action!=="update_policy"||reason.length<12)return Response.json({error:"Policy change needs action update_policy and a documented reason (12+ characters)."},{status:400});
  const candidate:WfmRosterRulePolicy={
    active:body.active,maxDailyMinutes:body.maxDailyMinutes,
    maxRollingSevenDayMinutes:body.maxRollingSevenDayMinutes,
    minRestBetweenShiftsMinutes:body.minRestBetweenShiftsMinutes,
    ordinaryDailyMinutes:body.ordinaryDailyMinutes,
    approvedOvertimeCapMinutes:body.approvedOvertimeCapMinutes,
    enforcementMode:body.enforcementMode,
  };
  if(!validateRosterRulePolicy(candidate))return Response.json({error:"Invalid roster thresholds or enforcement mode. Review PH scheduling policy limits."},{status:400});
  try{
    const saved=await db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(6107, ${organizationId})`);
      const [old]=await tx.select().from(workforceRosterRulePolicies).where(eq(workforceRosterRulePolicies.organizationId,organizationId)).limit(1);
      const [row]=await tx.insert(workforceRosterRulePolicies).values({...candidate,organizationId,updatedByUserId:user.id,updatedAt:new Date()})
        .onConflictDoUpdate({target:workforceRosterRulePolicies.organizationId,set:{...candidate,updatedByUserId:user.id,updatedAt:new Date()}}).returning();
      await tx.insert(auditEvents).values({
        organizationId,actor:user.name,action:"WFM roster policy updated",resource:"Workforce schedule rules",
        metadata:{before:old?{maxDailyMinutes:old.maxDailyMinutes,maxRollingSevenDayMinutes:old.maxRollingSevenDayMinutes,
          minRestBetweenShiftsMinutes:old.minRestBetweenShiftsMinutes,ordinaryDailyMinutes:old.ordinaryDailyMinutes,
          approvedOvertimeCapMinutes:old.approvedOvertimeCapMinutes,enforcementMode:old.enforcementMode,active:old.active}:PH_ROSTER_RULE_DEFAULTS,
          after:candidate,reason,changedByUserId:user.id},
      });
      return row;
    },{isolationLevel:"read committed"});
    return Response.json({policy:await loadWfmRosterRulePolicy(saved.organizationId),configured:true},{headers:noStore});
  }catch{return Response.json({error:"Policy was not committed; retry after refreshing."},{status:409,headers:noStore});}
}
