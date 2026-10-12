import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees, employeeWorksiteAssignments, timePunches,
  workforcePunchPhotoPolicies, workforcePunchPhotoConsents, workforcePunchPhotoEvidence,
} from "@/db/schema";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { documentUploadsEnabled, scanUpload, validateUpload } from "@/lib/storage";
import { encryptPunchPhoto, decryptPunchPhoto } from "@/lib/workforce-punch-photo-crypto";
import { DEFAULT_PUNCH_PHOTO_RETENTION_DAYS, PHOTO_CONSENT_PURPOSE, mayUploadPunchPhoto } from "@/lib/workforce-punch-evidence-policy";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const PRIVATE={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8a-f][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

async function employeeSession(organizationId:number){
 const user=await getSessionUser();
 if(!user)return {error:Response.json({error:"Authentication required."},{status:401})};
 if(user.role!=="employee"||!user.employeeId)
   return {error:Response.json({error:"Linked employee account required."},{status:403})};
 const denied=await assertMembership(user.id,organizationId);if(denied)return {error:denied};
 const [employee]=await db.select({id:employees.id,orgUnitId:employees.orgUnitId})
   .from(employees).where(and(eq(employees.organizationId,organizationId),eq(employees.id,user.employeeId))).limit(1);
 if(!employee)return {error:Response.json({error:"Employee not found in this employer."},{status:403})};
 return {user,employee};
}
async function assignedWorksite(organizationId:number,employeeId:number,at=new Date()){
 const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila"}).format(at);
 const rows=await db.select().from(employeeWorksiteAssignments).where(and(
   eq(employeeWorksiteAssignments.organizationId,organizationId),
   eq(employeeWorksiteAssignments.employeeId,employeeId),
   eq(employeeWorksiteAssignments.decision,"allow"),
 )).orderBy(desc(employeeWorksiteAssignments.effectiveFrom),desc(employeeWorksiteAssignments.id));
 return rows.find(row=>String(row.effectiveFrom)<=date
  &&(row.effectiveUntil==null||String(row.effectiveUntil)>=date))?.worksiteId??null;
}
async function photoSetting(organizationId:number,worksiteId:number|null){
 if(worksiteId===null)return null;
 const [policy]=await db.select().from(workforcePunchPhotoPolicies).where(and(
  eq(workforcePunchPhotoPolicies.organizationId,organizationId),
  eq(workforcePunchPhotoPolicies.worksiteId,worksiteId),
 )).limit(1);
 return policy??null;
}
export async function GET(request:Request){
 if(!criticalReleaseFlagEnabled("wfmPunchEvidence"))return Response.json({error:"Unavailable."},{status:404});
 const params=new URL(request.url).searchParams;
 const organizationId=Number(params.get("organizationId"));
 if(!Number.isSafeInteger(organizationId)||organizationId<1)return Response.json({error:"Valid employer required."},{status:400});
 const photoId=params.get("photoId");
 if(photoId){
  if(!UUID.test(photoId))return Response.json({error:"Invalid evidence id."},{status:400});
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401});
  const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,
    "Only authorized human reviewers may access evidence images.");
  if(denied)return denied;
  const [image]=await db.select().from(workforcePunchPhotoEvidence).where(and(
    eq(workforcePunchPhotoEvidence.id,photoId),
    eq(workforcePunchPhotoEvidence.organizationId,organizationId),
  )).limit(1);
  if(!image)return new Response(null,{status:404,headers:PRIVATE});
  if(image.expiresAt.getTime()<Date.now()&&!image.legalHold)return new Response(null,{status:410,headers:PRIVATE});
  const [employee]=await db.select({orgUnitId:employees.orgUnitId}).from(employees).where(and(
    eq(employees.id,image.employeeId),eq(employees.organizationId,organizationId),
  )).limit(1);
  const access=await getAccess(user.id,organizationId);
  const scope=assertScope(access,employee?.orgUnitId??null);
  if(!employee||!scope.ok)return Response.json({error:"Outside review scope."},{status:403});
  try{
    await recordAuditEvent({organizationId,actor:user.name,
      action:"Encrypted WFM punch image opened by reviewer",
      resource:"Attendance evidence",
      metadata:{photoEvidenceId:image.id,employeeId:image.employeeId}});
    const bytes=decryptPunchPhoto(image.sealedPhoto);
    return new Response(new Uint8Array(bytes),{headers:{...PRIVATE,"Content-Type":image.mimeType}});
  }catch{return Response.json({error:"Encrypted evidence unavailable."},{status:503});}
 }
 const auth=await employeeSession(organizationId);
 if(auth.error)return auth.error;
 const worksiteId=await assignedWorksite(organizationId,auth.employee!.id);
 const [setting,consent]=await Promise.all([
   photoSetting(organizationId,worksiteId),
   db.select().from(workforcePunchPhotoConsents).where(and(
     eq(workforcePunchPhotoConsents.organizationId,organizationId),
     eq(workforcePunchPhotoConsents.employeeId,auth.employee!.id),
   )).limit(1),
 ]);
 return Response.json({enabled:true,worksiteId,
   captureEnabled:setting?.captureEnabled===true,
   consent:consent[0]?.consented??null,
   retentionDays:setting?.retentionDays??DEFAULT_PUNCH_PHOTO_RETENTION_DAYS,
   purpose:PHOTO_CONSENT_PURPOSE,noAutomaticFaceMatching:true,
 },{headers:PRIVATE});
}
export async function POST(request:Request){
 const origin=enforceSameOriginMutation(request);if(origin)return origin;
 if(!criticalReleaseFlagEnabled("wfmPunchEvidence"))return Response.json({error:"Unavailable."},{status:404});
 // Consent and attachment use JSON. Actual photos use multipart, never base64 in logs.
 const formType=request.headers.get("content-type")??"";
 if(formType.includes("multipart/form-data")){
   const form=await request.formData().catch(()=>null);
   const organizationId=Number(form?.get("organizationId"));
   const auth=await employeeSession(organizationId);if(auth.error)return auth.error;
   const limited=await enforceSensitiveActionRateLimit(request,{userId:auth.user!.id,
     action:"wfm-punch-photo-upload",resourceId:organizationId,limit:12,windowMs:3600_000});
   if(limited)return limited;
   const worksiteId=await assignedWorksite(organizationId,auth.employee!.id);
   const action=String(form?.get("actionType")??"");
   if(!["clock_in","clock_out"].includes(action)||worksiteId===null)
     return Response.json({error:"A current assigned worksite and punch action are required."},{status:422});
   const [policy,consent]=await Promise.all([
     photoSetting(organizationId,worksiteId),
     db.select().from(workforcePunchPhotoConsents).where(and(
       eq(workforcePunchPhotoConsents.organizationId,organizationId),
       eq(workforcePunchPhotoConsents.employeeId,auth.employee!.id),
     )).limit(1),
   ]);
   if(!mayUploadPunchPhoto({featureEnabled:true,siteEnabled:policy?.captureEnabled===true,
      employeeConsented:consent[0]?.consented??null}))
     return Response.json({error:"Worksite photo policy and employee consent are required."},{status:403});
   if(!documentUploadsEnabled())return Response.json({error:"Security upload scanner is disabled."},{status:503});
   const file=form?.get("photo");
   if(!(file instanceof File)||file.size<1||file.size>512*1024)
     return Response.json({error:"Select a photo under 512 KB."},{status:413});
   const bytes=new Uint8Array(await file.arrayBuffer());
   const checked=validateUpload(bytes,file.type,file.name);
   if(!checked.ok||!["image/jpeg","image/png"].includes(checked.mime))
     return Response.json({error:"Only verified JPEG/PNG photos are permitted."},{status:422});
   const scanned=await scanUpload(bytes,{mime:checked.mime,fileName:file.name});
   if(scanned.unavailable||!scanned.scannedClean)
     return Response.json({error:"Image security scan unavailable; no image stored."},{status:503});
   let sealed:string;
   try{sealed=encryptPunchPhoto(bytes);}
   catch{return Response.json({error:"Encrypted photo evidence unavailable."},{status:503});}
   const id=randomUUID(),now=new Date();
   const expiresAt=new Date(now.getTime()+(policy?.retentionDays??90)*86_400_000);
   await db.insert(workforcePunchPhotoEvidence).values({
     id,organizationId,employeeId:auth.employee!.id,worksiteId,
     actionType:action,mimeType:checked.mime,byteSize:bytes.length,
     sealedPhoto:sealed,contentSha256:createHash("sha256").update(bytes).digest("hex"),
     expiresAt,
   });
   // The audit receipt intentionally excludes raw bytes and image content.
   await recordAuditEvent({organizationId,actor:auth.user!.name,
     action:"Optional time-punch photo evidence stored",resource:"Attendance evidence",
     metadata:{id,employeeId:auth.employee!.id,worksiteId,action,expiresAt:expiresAt.toISOString()}});
   return Response.json({photoEvidenceId:id,expiresAt:expiresAt.toISOString()},
     {status:201,headers:PRIVATE});
 }
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 const auth=await employeeSession(organizationId);if(auth.error)return auth.error;
 const limited=await enforceSensitiveActionRateLimit(request,{userId:auth.user!.id,
   action:"wfm-punch-photo-consent-link",resourceId:organizationId,limit:20,windowMs:300_000});
 if(limited)return limited;
 if(body.action==="consent"){
   if(typeof body.consented!=="boolean")return Response.json({error:"Consent choice required."},{status:400});
   const recordedAt=new Date();
   await db.insert(workforcePunchPhotoConsents).values({
     organizationId,employeeId:auth.employee!.id,consented:body.consented,
     purposeVersion:"wfm-photo-v1",recordedAt,
   }).onConflictDoUpdate({
     target:[workforcePunchPhotoConsents.organizationId,workforcePunchPhotoConsents.employeeId],
     set:{consented:body.consented,purposeVersion:"wfm-photo-v1",recordedAt},
   });
   await recordAuditEvent({organizationId,actor:auth.user!.name,
     action:body.consented?"Punch photo consent recorded":"Punch photo consent declined or withdrawn",
     resource:"Employee photo consent",metadata:{employeeId:auth.employee!.id,purposeVersion:"wfm-photo-v1"}});
   return Response.json({consent:body.consented},{headers:PRIVATE});
 }
 if(body.action==="link"){
   const photoId=String(body.photoEvidenceId??"");
   const punchId=Number(body.punchId);
   const actionType=String(body.actionType??"");
   if(!["clock_in","clock_out"].includes(actionType)
     ||!UUID.test(photoId)||!Number.isSafeInteger(punchId)||punchId<1)
     return Response.json({error:"Evidence id and punch id required."},{status:400});
   const [punch]=await db.select({id:timePunches.id,
     timeIn:timePunches.timeIn,timeOut:timePunches.timeOut}).from(timePunches).where(and(
     eq(timePunches.id,punchId),eq(timePunches.organizationId,organizationId),
     eq(timePunches.employeeId,auth.employee!.id),
   )).limit(1);
   if(!punch||!(actionType==="clock_in"?punch.timeIn:punch.timeOut))
     return Response.json({error:"Matching punched action was not recorded."},{status:404});
   const cutoff=new Date(Date.now()-60*60_000);
   const [linked]=await db.update(workforcePunchPhotoEvidence).set({punchId})
     .where(and(eq(workforcePunchPhotoEvidence.id,photoId),
       eq(workforcePunchPhotoEvidence.organizationId,organizationId),
       eq(workforcePunchPhotoEvidence.employeeId,auth.employee!.id),
       eq(workforcePunchPhotoEvidence.actionType,actionType),
       gte(workforcePunchPhotoEvidence.createdAt,cutoff),
     )).returning({id:workforcePunchPhotoEvidence.id});
   if(!linked)return Response.json({error:"Evidence is missing or too old to attach."},{status:409});
   return Response.json({linked:true,photoEvidenceId:photoId},{headers:PRIVATE});
 }
 return Response.json({error:"Unsupported evidence action."},{status:400});
}
