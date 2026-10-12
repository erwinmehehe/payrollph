import { and,eq,isNotNull,sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, workforcePunchPhotoConsents, workforcePunchPhotoEvidence } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertMembership } from "@/lib/access";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { enhancedPunchEnabled,enhancedPunchEnabledForOrganization,PUNCH_CONSENT_VERSION } from "@/lib/workforce-punch-evidence";
export const dynamic="force-dynamic";

/**
 * First consent is immutable except ACCEPTED -> DECLINED withdrawal.
 * Declined -> accepted needs a separately approved privacy workflow.
 * Withdrawal cryptographically removes usable non-held images and is audited
 * in the same transaction, without changing attendance or wages.
 */
export async function POST(request:Request) {
  if(!enhancedPunchEnabled())return Response.json({error:"Not found."},{status:404});
  const origin=enforceSameOriginMutation(request);if(origin)return origin;
  const user=await getSessionUser();
  if(!user||user.role!=="employee"||!user.employeeId)return Response.json({error:"Employee login required."},{status:403});
  const body=await request.json().catch(()=>({}));
  const org=Number(body.organizationId),choice=body.choice;
  if(!Number.isSafeInteger(org)||org<=0||!["accepted","declined"].includes(choice))
    return Response.json({error:"Invalid consent decision."},{status:400});
  if(!enhancedPunchEnabledForOrganization(org))return Response.json({error:"Not found."},{status:404});
  const denied=await assertMembership(user.id,org);if(denied)return denied;
  const [employee]=await db.select({id:employees.id}).from(employees).where(and(
    eq(employees.id,user.employeeId),eq(employees.organizationId,org),
  )).limit(1);
  if(!employee)return Response.json({error:"Employee not found."},{status:404});
  const limited=await enforceSensitiveActionRateLimit(request,{
    userId:user.id,action:"wfm-photo-consent",resourceId:org,limit:12,windowMs:300_000,
  });
  if(limited)return limited;
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6108, ${org})`);
    const [existing]=await tx.select({choice:workforcePunchPhotoConsents.choice})
      .from(workforcePunchPhotoConsents).where(and(
       eq(workforcePunchPhotoConsents.organizationId,org),
       eq(workforcePunchPhotoConsents.employeeId,employee.id),
       eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION),
      )).for("update").limit(1);
    if(existing?.choice==="declined"&&choice==="accepted")
      return {status:"reapproval-required" as const,choice:"declined" as const};
    if(existing?.choice===choice)
      return {status:"unchanged" as const,choice};
    if(existing){
      await tx.update(workforcePunchPhotoConsents).set({
        choice:"declined",decidedByUserId:user.id,decidedAt:new Date(),
      }).where(and(
        eq(workforcePunchPhotoConsents.organizationId,org),
        eq(workforcePunchPhotoConsents.employeeId,employee.id),
        eq(workforcePunchPhotoConsents.consentVersion,PUNCH_CONSENT_VERSION),
      ));
      await tx.update(workforcePunchPhotoEvidence).set({
        sealedPhoto:null,purgedAt:new Date(),
      }).where(and(
        eq(workforcePunchPhotoEvidence.organizationId,org),
        eq(workforcePunchPhotoEvidence.employeeId,employee.id),
        eq(workforcePunchPhotoEvidence.legalHold,false),
        isNotNull(workforcePunchPhotoEvidence.sealedPhoto),
      ));
    }else{
      await tx.insert(workforcePunchPhotoConsents).values({
        organizationId:org,employeeId:employee.id,
        consentVersion:PUNCH_CONSENT_VERSION,choice,decidedByUserId:user.id,
      });
    }
    await tx.insert(auditEvents).values({
      organizationId:org,actor:user.name,
      action:existing?"WFM selfie consent withdrawn":"WFM selfie consent recorded",
      resource:"WFM photo evidence",
      metadata:{employeeId:employee.id,consentVersion:PUNCH_CONSENT_VERSION,
        choice,nonHeldPhotoBytesPurged:Boolean(existing)},
    });
    return {status:"recorded" as const,choice};
  });
  if(result.status==="reapproval-required")
    return Response.json({error:"Re-acceptance requires a separately reviewed privacy process."},{status:409});
  return Response.json({ok:true,choice:result.choice,status:result.status},
    {headers:{"Cache-Control":"private, no-store"}});
}
