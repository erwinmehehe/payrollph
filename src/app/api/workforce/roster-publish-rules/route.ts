import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, workforceRosterPublishPolicies } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { DEFAULT_PH_ROSTER_PUBLISH_POLICY } from "@/lib/workforce-schedule-guardrails";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";
async function gate(organizationId:number){
  if(!criticalReleaseFlagEnabled("wfmRosterPublishRules")) return {error:Response.json({error:"Not enabled."},{status:404})};
  const user=await getSessionUser();
  if(!user) return {error:Response.json({error:"Unauthorized."},{status:401})};
  if(!Number.isSafeInteger(organizationId)||organizationId<1) return {error:Response.json({error:"Invalid organizationId."},{status:400})};
  const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"HR permissions required.");
  if(denied)return {error:denied};
  const access=await getAccess(user.id,organizationId);
  if(!access?.companyWide)return {error:Response.json({error:"Company-wide HR permissions required."},{status:403})};
  return {user};
}
export async function GET(request:Request){
 const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
 const auth=await gate(organizationId);if(auth.error)return auth.error;
 const [row]=await db.select().from(workforceRosterPublishPolicies)
   .where(eq(workforceRosterPublishPolicies.organizationId,organizationId)).limit(1);
 return Response.json({policy:row??DEFAULT_PH_ROSTER_PUBLISH_POLICY, configured:Boolean(row)});
}
export async function POST(request:Request){
 const originDenied=enforceSameOriginMutation(request);if(originDenied)return originDenied;
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 const auth=await gate(organizationId);if(auth.error)return auth.error;
 const mfa=requireSensitiveActionMfa(auth.user!);if(mfa)return mfa;
 const limit=await enforceSensitiveActionRateLimit(request,{userId:auth.user!.id,
   action:"wfm-roster-publish-policy",resourceId:organizationId,limit:10,windowMs:300_000});
 if(limit)return limit;
 const keys=["maxDailyMinutes","minimumRestMinutes","maxWeeklyMinutes"] as const;
 const values=keys.map(key=>Number(body[key]));
 if(values.some(value=>!Number.isSafeInteger(value)||value<0||value>10080)
   || !["block","advisory"].includes(body.enforcementMode)
   || (body.approvedOvertimeCapMinutes !== null && body.approvedOvertimeCapMinutes !== undefined
     && (!Number.isSafeInteger(body.approvedOvertimeCapMinutes)||body.approvedOvertimeCapMinutes<0
       || body.approvedOvertimeCapMinutes>10080))) {
   return Response.json({error:"Invalid scheduling caps or enforcement mode."},{status:400});
 }
 const update={maxDailyMinutes:values[0],minimumRestMinutes:values[1],
   maxWeeklyMinutes:values[2],approvedOvertimeCapMinutes:body.approvedOvertimeCapMinutes??null,
   enforcementMode:body.enforcementMode,active:body.active===true,
   updatedBy:auth.user!.name,updatedAt:new Date()};
 const row=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6107, ${organizationId})`);
  const [saved]=await tx.insert(workforceRosterPublishPolicies)
    .values({organizationId,...update})
    .onConflictDoUpdate({target:workforceRosterPublishPolicies.organizationId,set:update}).returning();
  await tx.insert(auditEvents).values({organizationId,actor:auth.user!.name,
    action:"WFM roster publish policy updated",resource:"Scheduling",
    metadata:{...update,updatedAt:update.updatedAt.toISOString()}});
  return saved;
 });
 return Response.json({policy:row});
}
