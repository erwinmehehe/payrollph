import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeWorksiteAssignments, employees, workforceOfflinePunchReceipts,
  worksiteGeofenceBoundaries,
} from "@/db/schema";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { classifyOfflinePunch, opaqueDeviceTokenHash, worksiteImpossibleTravel } from "@/lib/workforce-punch-evidence-policy";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8a-f][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const ACTIONS = new Set(["clock_in", "clock_out", "break_start", "break_end"]);

async function authorizedEmployee(organizationId:number) {
  const user=await getSessionUser();
  if(!user)return {error:Response.json({error:"Authentication required."},{status:401})};
  if(user.role!=="employee"||!user.employeeId)return {error:Response.json({error:"Only an employee can sync their own offline punch."},{status:403})};
  const denied=await assertMembership(user.id,organizationId);
  if(denied)return {error:denied};
  const [employee]=await db.select({id:employees.id,organizationId:employees.organizationId})
    .from(employees).where(and(eq(employees.id,user.employeeId),eq(employees.organizationId,organizationId))).limit(1);
  if(!employee)return {error:Response.json({error:"Linked employee is not in this organization."},{status:403})};
  return {user,employee};
}

export async function GET(request:Request){
 if(!criticalReleaseFlagEnabled("wfmOfflinePunchQueue"))return Response.json({error:"Unavailable."},{status:404});
 const user=await getSessionUser();
 if(!user)return Response.json({error:"Authentication required."},{status:401});
 const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
 if(!Number.isSafeInteger(organizationId)||organizationId<1)return Response.json({error:"Valid employer required."},{status:400});
 if(user.role==="employee"){
   const self=await authorizedEmployee(organizationId);
   if(self.error)return self.error;
   const rows=await db.select({
     id:workforceOfflinePunchReceipts.id,actionType:workforceOfflinePunchReceipts.actionType,
     deviceTimestamp:workforceOfflinePunchReceipts.deviceTimestamp,
     serverReceivedAt:workforceOfflinePunchReceipts.serverReceivedAt,
     flags:workforceOfflinePunchReceipts.reviewFlags,status:workforceOfflinePunchReceipts.status,
   }).from(workforceOfflinePunchReceipts).where(and(
     eq(workforceOfflinePunchReceipts.organizationId,organizationId),
     eq(workforceOfflinePunchReceipts.employeeId,self.employee!.id),
   )).orderBy(desc(workforceOfflinePunchReceipts.serverReceivedAt)).limit(100);
   return Response.json({receipts:rows,requiresHumanReview:true,canQueueSelf:true},{headers:PRIVATE});
 }
 const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,
   "HR review role required for offline receipts.");
 if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access)return Response.json({error:"No People access."},{status:403});
 const rows=await db.select({
   id:workforceOfflinePunchReceipts.id,
   employeeId:workforceOfflinePunchReceipts.employeeId,
   employeeOrgUnitId:employees.orgUnitId,
   actionType:workforceOfflinePunchReceipts.actionType,
   worksiteId:workforceOfflinePunchReceipts.worksiteId,
   deviceTimestamp:workforceOfflinePunchReceipts.deviceTimestamp,
   serverReceivedAt:workforceOfflinePunchReceipts.serverReceivedAt,
   flags:workforceOfflinePunchReceipts.reviewFlags,
   status:workforceOfflinePunchReceipts.status,
 }).from(workforceOfflinePunchReceipts).innerJoin(employees,and(
   eq(workforceOfflinePunchReceipts.employeeId,employees.id),
   eq(employees.organizationId,organizationId),
 )).where(and(eq(workforceOfflinePunchReceipts.organizationId,organizationId),
   eq(workforceOfflinePunchReceipts.status,"pending_review"),
   !access.companyWide?eq(employees.orgUnitId,access.orgUnitId!):undefined,
 )).orderBy(desc(workforceOfflinePunchReceipts.serverReceivedAt)).limit(100);
 return Response.json({receipts:rows,requiresHumanReview:true,canQueueSelf:false},{headers:PRIVATE});
}

export async function POST(request:Request){
 const origin=enforceSameOriginMutation(request);if(origin)return origin;
 if(!criticalReleaseFlagEnabled("wfmOfflinePunchQueue"))return Response.json({error:"Unavailable."},{status:404});
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 if(!Number.isSafeInteger(organizationId)||organizationId<1)return Response.json({error:"Valid employer required."},{status:400});
 const action=String(body.action??"");
 if(action==="sync"){
   const auth=await authorizedEmployee(organizationId);if(auth.error)return auth.error;
   const limited=await enforceSensitiveActionRateLimit(request,{userId:auth.user!.id,
     action:"offline-punch-sync",resourceId:organizationId,limit:120,windowMs:3600_000});
   if(limited)return limited;
   const id=String(body.id??"");
   const deviceToken=String(body.deviceToken??"");
   const actionType=String(body.actionType??"");
   const deviceTimestamp=String(body.deviceTimestamp??"");
   const worksiteId=body.worksiteId==null?null:Number(body.worksiteId);
   if(!UUID.test(id)||!ACTIONS.has(actionType)
     ||(worksiteId!==null&&(!Number.isSafeInteger(worksiteId)||worksiteId<1))){
     return Response.json({error:"Invalid offline receipt ID, worksite or action."},{status:400});
   }
   let hash:string;
   try{hash=opaqueDeviceTokenHash(deviceToken,process.env.PII_ENCRYPTION_KEY??"");}
   catch{return Response.json({error:"Secure device evidence hashing is not configured."},{status:503});}
   if(worksiteId!==null){
     const assigned=await db.select({id:employeeWorksiteAssignments.id}).from(employeeWorksiteAssignments)
       .where(and(eq(employeeWorksiteAssignments.organizationId,organizationId),
         eq(employeeWorksiteAssignments.employeeId,auth.employee!.id),
         eq(employeeWorksiteAssignments.worksiteId,worksiteId),
         eq(employeeWorksiteAssignments.decision,"allow"))).limit(1);
     if(!assigned.length)return Response.json({error:"Worksite not authorized for this employee."},{status:403});
   }
   const received=new Date();
   let classified:ReturnType<typeof classifyOfflinePunch>;
   try{classified=classifyOfflinePunch({deviceTimestamp,
     serverReceivedAt:received.toISOString(),
     skewThresholdMinutes:Number(process.env.WFM_OFFLINE_SKEW_MINUTES??5)});}
   catch{return Response.json({error:"Invalid device timestamp or skew setting."},{status:422});}
   // A device token is a random installation UUID. No device fingerprint, IP or GPS is stored.
   const [otherEmployee,previous] = await Promise.all([
     db.select({id:workforceOfflinePunchReceipts.id})
       .from(workforceOfflinePunchReceipts).where(and(
        eq(workforceOfflinePunchReceipts.organizationId,organizationId),
        eq(workforceOfflinePunchReceipts.deviceTokenHash,hash),
        ne(workforceOfflinePunchReceipts.employeeId,auth.employee!.id))).limit(1),
     db.select({
       id:workforceOfflinePunchReceipts.id,worksiteId:workforceOfflinePunchReceipts.worksiteId,
       deviceTimestamp:workforceOfflinePunchReceipts.deviceTimestamp,
     }).from(workforceOfflinePunchReceipts).where(and(
       eq(workforceOfflinePunchReceipts.organizationId,organizationId),
       eq(workforceOfflinePunchReceipts.employeeId,auth.employee!.id),
     )).orderBy(desc(workforceOfflinePunchReceipts.serverReceivedAt)).limit(1),
   ]);
   let impossibleTravel=false;
   if(previous[0]?.worksiteId!=null&&worksiteId!==null&&previous[0].worksiteId!==worksiteId){
     const geo=await db.select({
       worksiteId:worksiteGeofenceBoundaries.worksiteId,
       latitude:worksiteGeofenceBoundaries.latitude,
       longitude:worksiteGeofenceBoundaries.longitude,
     }).from(worksiteGeofenceBoundaries)
       .where(eq(worksiteGeofenceBoundaries.organizationId,organizationId));
     const start=geo.find(x=>x.worksiteId===previous[0].worksiteId);
     const end=geo.find(x=>x.worksiteId===worksiteId);
     if(start?.latitude!=null&&start.longitude!=null&&end?.latitude!=null&&end.longitude!=null){
       impossibleTravel=worksiteImpossibleTravel({
         first:{latitude:Number(start.latitude),longitude:Number(start.longitude),
           timestamp:new Date(previous[0].deviceTimestamp).toISOString()},
         second:{latitude:Number(end.latitude),longitude:Number(end.longitude),
           timestamp:classified.deviceTimestamp},
       });
     }
   }
   const flags=[...classified.flags,
     ...(otherEmployee.length?["same-device-multiple-employees"]:[]),
     ...(impossibleTravel?["impossible-travel"]:[])];
   // All offline entries, flagged or not, must be explicitly handled by HR.
   await db.insert(workforceOfflinePunchReceipts).values({
     id,organizationId,employeeId:auth.employee!.id,worksiteId,
     deviceTokenHash:hash,actionType,deviceTimestamp:new Date(classified.deviceTimestamp),
     serverReceivedAt:received,reviewFlags:flags,status:"pending_review",
   }).onConflictDoNothing();
   const [stored]=await db.select({
     employeeId:workforceOfflinePunchReceipts.employeeId,
     organizationId:workforceOfflinePunchReceipts.organizationId,
     actionType:workforceOfflinePunchReceipts.actionType,
     status:workforceOfflinePunchReceipts.status,
     reviewFlags:workforceOfflinePunchReceipts.reviewFlags,
   }).from(workforceOfflinePunchReceipts).where(eq(workforceOfflinePunchReceipts.id,id)).limit(1);
   if(!stored||stored.organizationId!==organizationId||stored.employeeId!==auth.employee!.id
     ||stored.actionType!==actionType)return Response.json({error:"Offline receipt conflict."},{status:409});
   return Response.json({id,status:stored.status,flags:stored.reviewFlags,
     note:"Pending human review. This is not a recorded payroll punch."},{status:202,headers:PRIVATE});
 }
 if(action==="review"){
   const user=await getSessionUser();
   if(!user)return Response.json({error:"Authentication required."},{status:401});
   const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,"HR reviewer required.");
   if(denied)return denied;
   const access=await getAccess(user.id,organizationId);
   if(!access)return Response.json({error:"Review scope unavailable."},{status:403});
   const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
   const id=String(body.id??"");
   const reason=String(body.reason??"").trim().slice(0,400);
   const decision=body.decision==="reviewed"?"reviewed":body.decision==="rejected"?"rejected":null;
   if(!UUID.test(id)||!decision||reason.length<12)return Response.json({error:"Receipt, decision and review reason required."},{status:400});
   const [receipt]=await db.select({
     id:workforceOfflinePunchReceipts.id,employeeId:workforceOfflinePunchReceipts.employeeId,
     orgUnitId:employees.orgUnitId,
   }).from(workforceOfflinePunchReceipts).innerJoin(employees,and(
     eq(workforceOfflinePunchReceipts.employeeId,employees.id),eq(employees.organizationId,organizationId)))
    .where(and(eq(workforceOfflinePunchReceipts.id,id),
      eq(workforceOfflinePunchReceipts.organizationId,organizationId))).limit(1);
   if(!receipt)return Response.json({error:"Receipt not found."},{status:404});
   const scope=assertScope(access,receipt.orgUnitId);
   if(!scope.ok||user.employeeId===receipt.employeeId)return Response.json({error:"Independent in-scope human reviewer required."},{status:403});
   const [updated]=await db.update(workforceOfflinePunchReceipts).set({
     status:decision,reviewerId:user.id,reviewReason:reason,reviewedAt:new Date(),
   }).where(and(eq(workforceOfflinePunchReceipts.id,id),
     eq(workforceOfflinePunchReceipts.organizationId,organizationId),
     eq(workforceOfflinePunchReceipts.status,"pending_review"))).returning();
   if(!updated)return Response.json({error:"Receipt already reviewed; refresh."},{status:409});
   await recordAuditEvent({organizationId,actor:user.name,action:"Offline punch evidence reviewed",
     resource:"Attendance evidence",metadata:{receiptId:id,decision,reason,
       requiresSeparateAttendanceCorrection:true}});
   return Response.json({id,status:decision,
     message:"Review recorded. Apply any accepted time only through the separate governed attendance correction workflow."});
 }
 return Response.json({error:"Unsupported action."},{status:400});
}
