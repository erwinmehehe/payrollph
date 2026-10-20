import { and,asc,eq,sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents,employees,timePunches,workforceAttendancePeriodLocks,workforcePunchSubmissions,workforcePunchPhotoEvidence } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole,getAccess,assertScope,WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { requireSensitiveActionMfa,enforceSameOriginMutation,enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { attendanceMutationLock } from "@/lib/workforce-attendance-lock";
import { markTimesheetsStaleForEmployeeDate } from "@/lib/workforce-timesheet-server";
import { reconcileAttendanceExceptionEvents } from "@/lib/workforce-attendance-exception-events";
import { enhancedPunchEnabled, enhancedPunchEnabledForOrganization, validPunchUuid } from "@/lib/workforce-punch-evidence";
import { decryptPunchPhoto } from "@/lib/workforce-punch-photo-crypto";
import { previousManilaWorkDate, resolveWebBundyPunchAnchor } from "@/lib/web-bundy-overnight-anchor";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const privateHeaders={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin"};
function manilaWorkDate(at:Date):string {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(at);
}
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
  if(!enhancedPunchEnabledForOrganization(organizationId))return Response.json({error:"Not found."},{status:404});
  const context=await reviewer(organizationId);if(context.denied)return context.denied;
  const photoId=params.get("photoId");
  if(photoId) {
    if(!validPunchUuid(photoId))return new Response(null,{status:404,headers:privateHeaders});
    // Photo access is separately sensitive even for an authorized manager.
    // Apply fresh MFA and a distributed limit before retrieving/decrypting bytes.
    const mfa=requireSensitiveActionMfa(context.user!);if(mfa)return mfa;
    const limited=await enforceSensitiveActionRateLimit(request,{
      userId:context.user!.id,action:"wfm-photo-access",resourceId:organizationId,
      limit:30,windowMs:5*60_000,
    });
    if(limited)return limited;
    const [photo]=await db.select().from(workforcePunchPhotoEvidence).where(and(eq(workforcePunchPhotoEvidence.id,photoId),eq(workforcePunchPhotoEvidence.organizationId,organizationId))).limit(1);
    if(!photo||!photo.sealedPhoto||photo.purgedAt||(!photo.legalHold&&photo.expiresAt<=new Date()))return new Response(null,{status:404,headers:privateHeaders});
    const [employee]=await db.select({orgUnitId:employees.orgUnitId}).from(employees).where(and(eq(employees.id,photo.employeeId),eq(employees.organizationId,organizationId))).limit(1);
    if(!employee||!assertScope(context.access,employee.orgUnitId).ok)return new Response(null,{status:404,headers:privateHeaders});
    await recordAuditEvent({
      organizationId,actor:context.user!.name,action:"Sensitive WFM photo evidence accessed",
      resource:"Attendance evidence",metadata:{photoId,employeeId:photo.employeeId},
    });
    try{return new Response(new Uint8Array(decryptPunchPhoto(photo.sealedPhoto)),{headers:{...privateHeaders,"Content-Type":"image/jpeg"}});}
    catch{return Response.json({error:"Cannot decrypt image."},{status:503,headers:privateHeaders});}
  }
  // Show oldest pending submissions first to allow chronologically dependent
  // clock-in -> break -> clock-out approval even with a large new-punch backlog.
  // Scope BEFORE the 100-row page limit. Otherwise company-wide rows can
  // starve a unit-scoped manager's queue indefinitely.
  const scopeClause=context.access?.companyWide?undefined:
    context.access?.orgUnitId==null?sql`false`:eq(employees.orgUnitId,context.access.orgUnitId);
  const rows=await db.select({submission:workforcePunchSubmissions,orgUnitId:employees.orgUnitId,name:employees.firstName,lastName:employees.lastName})
    .from(workforcePunchSubmissions).innerJoin(employees,and(eq(employees.id,workforcePunchSubmissions.employeeId),eq(employees.organizationId,organizationId)))
    .where(and(eq(workforcePunchSubmissions.organizationId,organizationId),
      eq(workforcePunchSubmissions.status,"pending"),scopeClause))
    .orderBy(asc(workforcePunchSubmissions.serverReceivedAt),
      asc(workforcePunchSubmissions.id)).limit(100);
  return Response.json({organizationId,submissions:rows.filter(row=>assertScope(context.access,row.orgUnitId).ok).map(row=>({
    ...row.submission,deviceDigest:undefined,name:row.name+" "+row.lastName,
  }))},{headers:privateHeaders});
}
export async function POST(request:Request) {
  if(!enhancedPunchEnabled())return Response.json({error:"Not found."},{status:404});
  const origin=enforceSameOriginMutation(request);if(origin)return origin;
  const body=await request.json().catch(()=>({}));
  const organizationId=Number(body.organizationId),id=Number(body.id);
  if(!Number.isSafeInteger(organizationId)||organizationId<=0||!Number.isSafeInteger(id)||id<=0)return Response.json({error:"Invalid request."},{status:400});
  if(!enhancedPunchEnabledForOrganization(organizationId))return Response.json({error:"Not found."},{status:404});
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

  // An APPROVAL is an attendance capture, not an authorization to bypass
  // attendance/payroll cutoffs. Re-check the effective day inside the TX.
  let approvedWorkDate:string|null=null;
  let approvedChosenDay:string|null=null;
  let result;
  try {
    result=await db.transaction(async tx=>{
      // Order is organization cutoff lock, then employee review lock.
      // Attendance cutoff administrators take the same organization lock.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6109, ${organizationId})`);
      // Serialize reviews for the entire employee, not only the selected
      // submission. The existing Web Bundy endpoint is disabled in pilot mode.
      await tx.execute(sql`select pg_advisory_xact_lock(${organizationId}::integer, ${submission.employeeId}::integer)`);
      const [fresh]=await tx.select().from(workforcePunchSubmissions).where(and(
        eq(workforcePunchSubmissions.id,id),eq(workforcePunchSubmissions.organizationId,organizationId),
      )).for("update").limit(1);
      if(!fresh||fresh.status!=="pending")throw Error("Already decided.");
      if(fresh.requestedByUserId===context.user!.id)throw Error("Maker cannot approve or reject their own punch.");
      const target=timeSource==="device"?fresh.deviceOccurredAt:fresh.serverReceivedAt;
      if(!Number.isFinite(target.getTime()))throw Error("Punch timestamp is invalid.");
      const chosenDate=manilaWorkDate(target);
      const previousDate=previousManilaWorkDate(chosenDate);
      let punchId:number|null=null;
      let effectiveDate=String(fresh.workDate);
      if(decision==="approved"){
        // Lock both dates before choosing the attendance anchor; disallow
        // duplicate imported or corrected rows rather than guessing.
        const todayRows=await tx.select().from(timePunches).where(and(
          eq(timePunches.organizationId,organizationId),
          eq(timePunches.employeeId,fresh.employeeId),
          eq(timePunches.workDate,chosenDate),
        )).for("update").limit(2);
        const previousRows=await tx.select().from(timePunches).where(and(
          eq(timePunches.organizationId,organizationId),
          eq(timePunches.employeeId,fresh.employeeId),
          eq(timePunches.workDate,previousDate),
        )).for("update").limit(2);
        if(todayRows.length>1||previousRows.length>1)
          throw Error("Conflicting attendance rows require manual correction.");
        const anchor=resolveWebBundyPunchAnchor({
          today:chosenDate,now:target,todayPunch:todayRows[0]??null,
          previousPunch:previousRows[0]??null,
          action:fresh.actionType as "clock_in"|"break_start"|"break_end"|"clock_out",
        });
        if(anchor.previousShiftNeedsReview)
          throw Error("Previous shift has an unresolved conflict; request a reviewed correction.");
        if(anchor.previousOpenRequiresClose)
          throw Error("A previous shift remains open; close it or request a reviewed correction.");
        effectiveDate=anchor.workDate;
        const current=anchor.usePrevious?previousRows[0]:todayRows[0];
        if(current&&current.source!=="web_bundy")
          throw Error("Non-Web-Bundy attendance can only be changed by an authorized HR correction.");
        const locks=(await tx.select().from(workforceAttendancePeriodLocks).where(
          eq(workforceAttendancePeriodLocks.organizationId,organizationId),
        ).for("share")).filter(lock=>lock.status==="locked");
        // Lock both the original device day and all dates touched by the
        // selected timestamp. No cutoff can be bypassed by choosing "server".
        for(const date of new Set([String(fresh.workDate),chosenDate,effectiveDate])){
          if(attendanceMutationLock(locks,date,"capture"))
            throw Error("Attendance or payroll cutoff is locked; request an authorized HR correction.");
        }
        const update:Record<string,Date>={};
        if(fresh.actionType==="clock_in"){
          if(current?.timeIn||current?.timeOut||current?.breakStart||current?.breakEnd)
            throw Error("Clock-in conflicts with existing attendance.");
          update.timeIn=target;
        }else if(fresh.actionType==="clock_out"){
          if(!current?.timeIn||current.timeOut||target<=current.timeIn||
            (current.breakStart&&!current.breakEnd)||(current.breakEnd&&target<=current.breakEnd))
            throw Error("Clock-out conflicts with existing attendance.");
          update.timeOut=target;
        }else if(fresh.actionType==="break_start"){
          if(!current?.timeIn||current.breakStart||current.timeOut||target<=current.timeIn)
            throw Error("Break-start conflicts with existing attendance.");
          update.breakStart=target;
        }else if(fresh.actionType==="break_end"){
          if(!current?.breakStart||current.breakEnd||current.timeOut||target<=current.breakStart)
            throw Error("Break-end conflicts with existing attendance.");
          update.breakEnd=target;
        }else throw Error("Invalid punch action.");
        if(current){
          const [updated]=await tx.update(timePunches).set({
            ...update,status:fresh.actionType==="clock_out"?"Complete":"Incomplete",
            notes:"Approved enhanced Web Bundy evidence #"+id,
          }).where(and(eq(timePunches.id,current.id),eq(timePunches.organizationId,organizationId)))
            .returning({id:timePunches.id});
          if(!updated)throw Error("Attendance changed during review; retry.");
          punchId=updated.id;
        }else{
          if(fresh.actionType!=="clock_in")throw Error("Clock in before approving subsequent punch actions.");
          const location=fresh.worksiteId
            ? (fresh.flags.includes("geofence-verified")?"GPS-verified worksite #":"Assigned worksite #")+fresh.worksiteId
            : "Web Bundy (worksite not verified)";
          const [created]=await tx.insert(timePunches).values({
            organizationId,employeeId:fresh.employeeId,workDate:effectiveDate,timeIn:target,
            status:"Incomplete",source:"web_bundy",location,
            notes:"Approved enhanced Web Bundy evidence #"+id,
          }).returning({id:timePunches.id});
          punchId=created.id;
        }
        // Invalidate calculated timecards for every affected Manila day,
        // within this same transaction as the attendance change and audit.
        for(const workDate of new Set([effectiveDate,chosenDate,String(fresh.workDate)])){
          await markTimesheetsStaleForEmployeeDate({
            organizationId,employeeId:fresh.employeeId,workDate,executor:tx,
          });
        }
        approvedWorkDate=effectiveDate;
        approvedChosenDay=chosenDate;
      }
      const [saved]=await tx.update(workforcePunchSubmissions).set({
        status:decision,reviewedByUserId:context.user!.id,
        reviewedAt:new Date(),reviewNote,
        approvedTimeSource:decision==="approved"?timeSource:null,timePunchId:punchId,
      }).where(and(
        eq(workforcePunchSubmissions.id,id),eq(workforcePunchSubmissions.organizationId,organizationId),
        eq(workforcePunchSubmissions.status,"pending"),
      )).returning({
        id:workforcePunchSubmissions.id,
        organizationId:workforcePunchSubmissions.organizationId,
        employeeId:workforcePunchSubmissions.employeeId,
        status:workforcePunchSubmissions.status,
      });
      if(!saved)throw Error("Already decided.");
      await tx.insert(auditEvents).values({
        organizationId,actor:context.user!.name,action:"Enhanced Web Bundy punch "+decision,
        resource:String(id),metadata:{
          submissionId:id,employeeId:fresh.employeeId,
          decision,reviewNote,timeSource:decision==="approved"?timeSource:null,
          sourceWorkDate:String(fresh.workDate),approvedWorkDate:decision==="approved"?effectiveDate:null,
          flags:fresh.flags,
        },
      });
      return saved;
    });
  }catch{
    // Never return raw PostgreSQL, schema or employee details in API errors.
    return Response.json({
      error:"Attendance review conflicted or could not be completed. Request an authorized HR correction.",
      code:"ATTENDANCE_REVIEW_CONFLICT",
    },{status:409,headers:privateHeaders});
  }
  if(decision==="approved"&&approvedWorkDate){
    try{
      // Cross-midnight attendance affects both the shift-start and
      // completion day; ensure exception state tracks both.
      for(const workDate of new Set([approvedWorkDate,approvedChosenDay])){
        if(workDate)await reconcileAttendanceExceptionEvents({
          organizationId,employeeId:submission.employeeId,workDate,
        });
      }
    }catch{
      // The transaction committed. Do not claim the whole review failed and
      // tempt a second attendance promotion; expose the partial sync warning.
      return Response.json({ok:true,organizationId,submission:result,approvedWorkDate,
        warning:"Attendance approved; exception reconciliation requires follow-up."},{headers:privateHeaders});
    }
  }
  return Response.json({ok:true,organizationId,submission:result,approvedWorkDate},{headers:privateHeaders});
}
