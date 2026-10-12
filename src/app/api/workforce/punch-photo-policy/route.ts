import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, worksites, workforcePunchPhotoPolicies } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic="force-dynamic";
export async function POST(request:Request){
 const origin=enforceSameOriginMutation(request);if(origin)return origin;
 if(!criticalReleaseFlagEnabled("wfmPunchEvidence"))return Response.json({error:"Unavailable."},{status:404});
 const user=await getSessionUser();
 if(!user)return Response.json({error:"Authentication required."},{status:401});
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId),worksiteId=Number(body.worksiteId);
 if(!Number.isSafeInteger(organizationId)||organizationId<1||!Number.isSafeInteger(worksiteId)||worksiteId<1
  ||typeof body.captureEnabled!=="boolean"
  ||!Number.isSafeInteger(body.retentionDays)||body.retentionDays<1||body.retentionDays>365){
   return Response.json({error:"Valid worksite, consent policy and 1-365 day retention required."},{status:400});
 }
 const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"HR admin role required.");
 if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Company-wide HR access required."},{status:403});
 const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
 const rate=await enforceSensitiveActionRateLimit(request,{userId:user.id,action:"wfm-photo-policy",
  resourceId:organizationId,limit:10,windowMs:300_000});if(rate)return rate;
 const [worksite]=await db.select({id:worksites.id}).from(worksites).where(and(
  eq(worksites.id,worksiteId),eq(worksites.organizationId,organizationId),
  eq(worksites.active,true),
 )).limit(1);
 if(!worksite)return Response.json({error:"Worksite not found in this tenant."},{status:404});
 await db.transaction(async tx=>{
   await tx.insert(workforcePunchPhotoPolicies).values({
     organizationId,worksiteId,captureEnabled:body.captureEnabled,retentionDays:body.retentionDays,
   }).onConflictDoUpdate({
     target:[workforcePunchPhotoPolicies.organizationId,workforcePunchPhotoPolicies.worksiteId],
     set:{captureEnabled:body.captureEnabled,retentionDays:body.retentionDays,updatedAt:new Date()},
   });
   await tx.insert(auditEvents).values({organizationId,actor:user.name,
     action:"Optional punch photo worksite policy updated",resource:"Worksite evidence",
     metadata:{worksiteId,captureEnabled:body.captureEnabled,retentionDays:body.retentionDays}});
 });
 return Response.json({updated:true});
}
