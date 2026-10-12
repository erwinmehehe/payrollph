import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, hcmSimpleGoals } from "@/db/schema";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { canIndependentlyReviewGoal } from "@/lib/hcm-simple-growth";

export const dynamic="force-dynamic";
const PRIVATE={"Cache-Control":"private, no-store"};
async function authorized(organizationId:number){
 if(!criticalReleaseFlagEnabled("hcmSimpleGoals"))
  return {error:Response.json({error:"Goal reviews unavailable."},{status:404})};
 const user=await getSessionUser();
 if(!user)return {error:Response.json({error:"Authentication required."},{status:401})};
 if(!Number.isSafeInteger(organizationId)||organizationId<1)
  return {error:Response.json({error:"Valid employer required."},{status:400})};
 const denied=await assertMembership(user.id,organizationId);if(denied)return {error:denied};
 return {user};
}
export async function GET(request:Request){
 const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
 const auth=await authorized(organizationId);if(auth.error)return auth.error;
 const user=auth.user!;
 if(user.role==="employee"&&!user.employeeId)
   return Response.json({error:"Linked employee required."},{status:403});
 if(user.role!=="employee"){
   const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,
     "People role required.");if(denied)return denied;
 }
 const access=user.role==="employee"?null:await getAccess(user.id,organizationId);
 if(user.role!=="employee"&&!access)return Response.json({error:"No People scope."},{status:403});
 const rows=await db.select({
   id:hcmSimpleGoals.id,employeeId:hcmSimpleGoals.employeeId,
   employeeOrgUnitId:employees.orgUnitId,
   title:hcmSimpleGoals.title,description:hcmSimpleGoals.description,
   dueDate:hcmSimpleGoals.dueDate,status:hcmSimpleGoals.status,
   reviewScore:hcmSimpleGoals.reviewScore,reviewNotes:hcmSimpleGoals.reviewNotes,
   employeeAcknowledgedAt:hcmSimpleGoals.employeeAcknowledgedAt,
 }).from(hcmSimpleGoals).innerJoin(employees,and(
   eq(hcmSimpleGoals.employeeId,employees.id),
   eq(employees.organizationId,organizationId),
 )).where(and(eq(hcmSimpleGoals.organizationId,organizationId),
   user.role==="employee"?eq(hcmSimpleGoals.employeeId,user.employeeId!):
     !access!.companyWide?eq(employees.orgUnitId,access!.orgUnitId!):undefined,
 )).orderBy(asc(hcmSimpleGoals.id)).limit(500);
 return Response.json({goals:rows,viewerRole:user.role},{headers:PRIVATE});
}
export async function POST(request:Request){
 const origin=enforceSameOriginMutation(request);if(origin)return origin;
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 const auth=await authorized(organizationId);if(auth.error)return auth.error;
 const user=auth.user!;
 const action=String(body.action??"");
 const limited=await enforceSensitiveActionRateLimit(request,{userId:user.id,
   action:"simple-goals-"+action,resourceId:organizationId,limit:30,windowMs:300_000});
 if(limited)return limited;
 if(action==="acknowledge"){
   const goalId=Number(body.goalId);
   if(user.role!=="employee"||!user.employeeId||!Number.isSafeInteger(goalId)||goalId<1)
     return Response.json({error:"Linked employee and goal required."},{status:403});
   const [row]=await db.update(hcmSimpleGoals).set({
     status:"acknowledged",employeeAcknowledgedAt:new Date(),
   }).where(and(eq(hcmSimpleGoals.id,goalId),
     eq(hcmSimpleGoals.organizationId,organizationId),
     eq(hcmSimpleGoals.employeeId,user.employeeId),
     eq(hcmSimpleGoals.status,"reviewed"))).returning({id:hcmSimpleGoals.id});
   if(!row)return Response.json({error:"Goal is not ready to acknowledge."},{status:409});
   return Response.json({status:"acknowledged"});
 }
 const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES,
  "Authorized HR reviewer required.");if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access)return Response.json({error:"People scope required."},{status:403});
 const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
 if(action==="create"){
   const employeeId=Number(body.employeeId);
   const title=String(body.title??"").trim().slice(0,180);
   const description=String(body.description??"").trim().slice(0,2000);
   const dueDate=String(body.dueDate??"");
   if(!Number.isSafeInteger(employeeId)||employeeId<1||title.length<5||description.length<10
      ||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ||!Number.isFinite(Date.parse(dueDate+"T00:00:00Z"))
      ||new Date(dueDate+"T00:00:00Z").toISOString().slice(0,10)!==dueDate)
     return Response.json({error:"Valid employee, goal title/description and due date required."},{status:400});
   const [employee]=await db.select({orgUnitId:employees.orgUnitId}).from(employees)
     .where(and(eq(employees.id,employeeId),eq(employees.organizationId,organizationId))).limit(1);
   if(!employee)return Response.json({error:"Employee not found in employer."},{status:404});
   const scoped=assertScope(access,employee.orgUnitId);if(!scoped.ok)
     return Response.json({error:scoped.error},{status:scoped.status});
   const [goal]=await db.insert(hcmSimpleGoals).values({
     organizationId,employeeId,title,description,dueDate,createdByUserId:user.id,
   }).returning({id:hcmSimpleGoals.id});
   await db.insert(auditEvents).values({organizationId,actor:user.name,
      action:"Employee simple goal created",resource:"Employee goal",metadata:{goalId:goal.id,employeeId}});
   return Response.json({goalId:goal.id},{status:201});
 }
 if(action==="review"){
   const goalId=Number(body.goalId),score=Number(body.score);
   const notes=String(body.notes??"").trim().slice(0,1000);
   if(!Number.isSafeInteger(goalId)||goalId<1||!Number.isSafeInteger(score)||score<1||score>5
      ||notes.length<10)return Response.json({error:"Valid goal, 1-5 score and review notes required."},{status:400});
   const [goal]=await db.select({
     id:hcmSimpleGoals.id,employeeId:hcmSimpleGoals.employeeId,
     makerUserId:hcmSimpleGoals.createdByUserId,status:hcmSimpleGoals.status,
     orgUnitId:employees.orgUnitId,
   }).from(hcmSimpleGoals).innerJoin(employees,and(
     eq(hcmSimpleGoals.employeeId,employees.id),eq(employees.organizationId,organizationId),
   )).where(and(eq(hcmSimpleGoals.id,goalId),
     eq(hcmSimpleGoals.organizationId,organizationId))).limit(1);
   if(!goal)return Response.json({error:"Goal not found."},{status:404});
   const scoped=assertScope(access,goal.orgUnitId);
   if(!scoped.ok)return Response.json({error:scoped.error},{status:scoped.status});
   if(!canIndependentlyReviewGoal({makerUserId:goal.makerUserId,
     reviewerUserId:user.id,employeeUserId:user.employeeId,alreadyReviewed:goal.status!=="active"}))
     return Response.json({error:"Goal author or employee cannot self-review; assign an independent reviewer."},{status:403});
   const updated=await db.transaction(async tx=>{
     const [row]=await tx.update(hcmSimpleGoals).set({
       status:"reviewed",reviewScore:score,reviewNotes:notes,
       reviewerUserId:user.id,reviewedAt:new Date(),
     }).where(and(eq(hcmSimpleGoals.id,goalId),
       eq(hcmSimpleGoals.organizationId,organizationId),
       eq(hcmSimpleGoals.status,"active"),
     )).returning({id:hcmSimpleGoals.id});
     if(!row)return null;
     await tx.insert(auditEvents).values({organizationId,actor:user.name,
       action:"Employee goal independently reviewed",resource:"Employee goal",
       metadata:{goalId,employeeId:goal.employeeId,score}});
     return row;
   });
   if(!updated)return Response.json({error:"Goal already reviewed."},{status:409});
   return Response.json({goalId,status:"reviewed"});
 }
 return Response.json({error:"Unsupported goal action."},{status:400});
}
