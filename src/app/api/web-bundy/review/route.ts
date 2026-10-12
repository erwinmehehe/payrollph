import { and,desc,eq,sql } from "drizzle-orm";
import { db } from "@/db";
import { employees,timePunches,workforcePunchSubmissions,workforcePunchPhotoEvidence } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole,getAccess,assertScope,WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { requireSensitiveActionMfa,enforceSameOriginMutation,enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { attendanceMutationLock,loadActiveAttendanceLocks } from "@/lib/workforce-attendance-lock";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { reconcileAttendanceExceptionEvents } from "@/lib/workforce-attendance-exception-events";
import { enhancedPunchEnabled } from "@/lib/workforce-punch-evidence";
import { decryptPunchPhoto } from "@/lib/workforce-punch-photo-crypto";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const privateHeaders={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
async function reviewer(organizationId:number) {
  const user=await getSessionUser();
  if(!user)return {denied:Response.json({error:"Unauthorized."},{status:401}),user:null,access:null};
  const denied=await assertOrganizationRole(user.id,organizationId,WORKFORCE_MANAGER_ROLES,"Workforce reviewer permission required.");
  if(denied)return {denied,user,access:null};
  const access=await getAccess(user.id,organizationId);
  return {denied:access?null:Response.json({error:"No workforce scope."},{status:403}),user,access};
}
async function visible(org:number, id:number, userId:number) {
  const [row]=await db.select({submission:workforcePunchSubmissions,orgUnitId:employees.orgUnitId})
    .from(workforcePunchSubmissions).innerJoin(employees,and(eq(employees.id,workforcePunchSubmissions.employeeId),eq(employees.organizationId,org)))
    .where(and(eq(workforcePunchSubmissions.id,id),eq(workforcePunchSubmissions.organizationId,org))).limit(1);
  if(!row)return null;
  const access=await getAccess(userId,org);
  if(!assertScope(access,row.orgUnitId).ok)return null;
  return row.submission;
}
export async function GET(request:Request) {
  if(!enhancedPunchEnabled())return Response.json({error:"Not found."},{status:404});
  const params=new URL(request.url).searchParams,organizationId=Number(params.get("organizationId"));
  if(!Number.isSafeInteger(organizationId)||organizationId<=0)return Response.json({error:"Invalid employer."},{status:400});
  const context=await reviewer(organizationId);if(context.denied)return context.denied;
  const photoId=params.get("photoId");
  if(photoId) {
    const [photo]=await db.select().from(workforcePunchPhotoEvidence).where(and(eq(workforcePunchPhotoEvidence.id,photoId),eq(workforcePunchPhotoEvidence.organizationId,organizationId))).limit(1);
    if(!photo||!photo.sealedPhoto||photo.purgedAt||(!photo.legalHold&&photo.expiresAt<=new Date()))return new Response(null,{status:404,headers:privateHeaders});
    const [employee]=await db.select({orgUnitId:employees.orgUnitId}).from(employees).where(and(eq(employees.id,photo.employeeId),eq(employees.organizationId,organizationId))).limit(1);
    if(!employee||!assertScope(context.access,employee.orgUnitId).ok)return new Response(null,{status:404,headers:privateHeaders});
    try{return new Response(new Uint8Array(decryptPunchPhoto(photo.sealedPhoto)),{headers:{...privateHeaders,"Content-Type":"image/jpeg"}});}
    catch{return Response.json({error:"Cannot decrypt image."},{status:503,headers:privateHeaders});}
  }
  const rows=await db.select({submission:workforcePunchSubmissions,orgUnitId:employees.orgUnitId,name:employees.firstName,lastName:employees.lastName})
    .from(workforcePunchSubmissions).innerJoin(employees,and(eq(employees.id,workforcePunchSubmissions.employeeId),eq(employees.organizationId,organizationId)))
    .where(and(eq(workforcePunchSubmissions.organizationId,organizationId),eq(workforcePunchSubmissions.status,"pending")))
    .orderBy(desc(workforcePunchSubmissions.id)).limit(100);
  return Response.json({submissions:rows.filter(row=>assertScope(context.access,row.orgUnitId).ok).map(row=>({
    ...row.submission,deviceDigest:undefined,name:row.name+" "+row.lastName,
  }))},{headers:privateHeaders});
}
export async function POST(request:Request) {
  if(!enhancedPunchEnabled())return Response.json({error:"Not found."},{status:404});
  const origin=enforceSameOriginMutation(request);if(origin)return origin;
  const body=await request.json().catch(()=>({}));
  const organizationId=Number(body.organizationId),id=Number(body.id);
  if(!Number.isSafeInteger(organizationId)||organizationId<=0||!Number.isSafeInteger(id)||id<=0)return Response.json({error:"Invalid request."},{status:400});
  const context=await reviewer(organizationId);if(context.denied)return context.denied;
  const mfa=requireSensitiveActionMfa(context.user!);if(mfa)return mfa;
  const limit=await enforceSensitiveActionRateLimit(request,{userId:context.user!.id,action:"review-enhanced-punch",resourceId:organizationId,limit:40,windowMs:5*60_000});if(limit)return limit;
  const submission=await visible(organizationId,id,context.user!.id);
  if(!submission)return Response.json({error:"Submission unavailable."},{status:404});
  if(submission.status!=="pending")return Response.json({error:"Already reviewed."},{status:409});
  if(submission.requestedByUserId===context.user!.id)return Response.json({error:"Maker cannot check their own punch."},{status:403});
  const decision=String(body.decision),timeSource=String(body.timeSource),reviewNote=String(body.note??"").trim().slice(0,240);
  if(!["approved","rejected"].includes(decision)||reviewNote.length<10||decision==="approved"&&!["device","server"].includes(timeSource))
    return Response.json({error:"Decision, explanation (10+ characters), and time source for approval are required."},{status:400});
  const lock=attendanceMutationLock(await loadActiveAttendanceLocks(organizationId),String(submission.workDate),"correction");
  if(lock&&decision==="approved")return Response.json({error:"Attendance locked. Reopen with authorized correction first."},{status:423});
  const target= timeSource==="device"?submission.deviceOccurredAt:submission.serverReceivedAt;
  // A reviewer cannot cause a time reversal. Default to no paid-hour mutation on any error.
  let result;
  try {
    result=await db.transaction(async tx=>{
      const [locked]=await tx.execute(sql`select id from workforce_punch_submissions where id = ${id} and organization_id = ${organizationId} and status = 'pending' for update`);
      if(!locked)throw Error("Already decided.");
      const [current]=await tx.select().from(timePunches).where(and(eq(timePunches.organizationId,organizationId),
        eq(timePunches.employeeId,submission.employeeId),eq(timePunches.workDate,submission.workDate))).limit(1);
      let punchId:number|null=null;
      if(decision==="approved") {
        const update:Record<string,Date>={};
        if(submission.actionType==="clock_in") {
          if(current?.timeIn||current?.timeOut)throw Error("Clock-in conflicts with existing attendance.");
          update.timeIn=target;
        } else if(submission.actionType==="clock_out"){
          if(!current?.timeIn||current.timeOut||target<=current.timeIn||(current.breakStart&&!current.breakEnd))throw Error("Clock-out conflicts with existing attendance.");
          update.timeOut=target;
        }else if(submission.actionType==="break_start"){
          if(!current?.timeIn||current.breakStart||current.timeOut||target<=current.timeIn)throw Error("Break-start conflicts with existing attendance.");
          update.breakStart=target;
        }else if(submission.actionType==="break_end"){
          if(!current?.breakStart||current.breakEnd||current.timeOut||target<=current.breakStart)throw Error("Break-end conflicts with existing attendance.");
          update.breakEnd=target;
        } else throw Error("Invalid punch action.");
        if(current) {
          const [updated]=await tx.update(timePunches).set({...update,status:submission.actionType==="clock_out"?"Complete":"Incomplete",notes:"Approved enhanced Web Bundy evidence #"+id})
            .where(and(eq(timePunches.id,current.id),eq(timePunches.organizationId,organizationId))).returning({id:timePunches.id});
          punchId=updated.id;
        }else{
          const [created]=await tx.insert(timePunches).values({
            organizationId,employeeId:submission.employeeId,workDate:submission.workDate,timeIn:target,
            status:"Incomplete",source:"web_bundy",location:submission.worksiteId?"Verified worksite #"+submission.worksiteId:"Web Bundy",
            notes:"Approved enhanced Web Bundy evidence #"+id,
          }).returning({id:timePunches.id});
          punchId=created.id;
        }
      }
      const [saved]=await tx.update(workforcePunchSubmissions).set({status:decision,reviewedByUserId:context.user!.id,
        reviewedAt:new Date(),reviewNote,approvedTimeSource:decision==="approved"?timeSource:null,timePunchId:punchId})
        .where(and(eq(workforcePunchSubmissions.id,id),eq(workforcePunchSubmissions.organizationId,organizationId),
          eq(workforcePunchSubmissions.status,"pending"))).returning({id:workforcePunchSubmissions.id,status:workforcePunchSubmissions.status});
      if(!saved)throw Error("Already decided.");
      return saved;
    });
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Review conflict."},{status:409});}
  if(decision==="approved") {
    await markTimesheetsStaleForEmployeeDate({organizationId,employeeId:submission.employeeId,workDate:String(submission.workDate)});
    await reconcileAttendanceExceptionEvents({organizationId,employeeId:submission.employeeId,workDate:String(submission.workDate)});
  }
  await recordAuditEvent({organizationId,actor:context.user!.name,action:"Enhanced Web Bundy punch "+decision,resource:String(id),
    metadata:{submissionId:id,employeeId:submission.employeeId,decision,reviewNote,timeSource:decision==="approved"?timeSource:null,flags:submission.flags}});
  return Response.json({ok:true,submission:result},{headers:privateHeaders});
}
