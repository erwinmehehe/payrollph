import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, hcmPulseSurveys, hcmPulseSurveyResponses } from "@/db/schema";
import { assertMembership, assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa } from "@/lib/security-request";
import { anonymousSurveyResponderHash, aggregateClosedPulse } from "@/lib/hcm-simple-growth";

export const dynamic="force-dynamic";
const PRIVATE={"Cache-Control":"private, no-store"};

async function scope(organizationId:number) {
 if(!criticalReleaseFlagEnabled("hcmEngagementSurvey"))
  return {error:Response.json({error:"Survey module unavailable."},{status:404})};
 const user=await getSessionUser();
 if(!user)return {error:Response.json({error:"Authentication required."},{status:401})};
 if(!Number.isSafeInteger(organizationId)||organizationId<1)
   return {error:Response.json({error:"Valid employer required."},{status:400})};
 const denied=await assertMembership(user.id,organizationId);
 if(denied)return {error:denied};
 return {user};
}
async function admin(userId:number,organizationId:number){
 const denied=await assertOrganizationRole(userId,organizationId,PEOPLE_ADMIN_ROLES,
  "People administration required for surveys.");
 if(denied)return denied;
 const access=await getAccess(userId,organizationId);
 if(!access?.companyWide)
  return Response.json({error:"Company-wide People administration required."},{status:403});
 return null;
}
export async function GET(request:Request){
 const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
 const auth=await scope(organizationId);if(auth.error)return auth.error;
 const [employee]=auth.user!.employeeId
  ?await db.select({id:employees.id}).from(employees).where(and(
    eq(employees.organizationId,organizationId),
    eq(employees.id,auth.user!.employeeId),
  )).limit(1):[null];
 if(auth.user!.role==="employee"&&!employee)
   return Response.json({error:"Linked employee required."},{status:403});
 if(auth.user!.role!=="employee"){
  const denied=await admin(auth.user!.id,organizationId);if(denied)return denied;
 }
 const rows=await db.select({id:hcmPulseSurveys.id,question:hcmPulseSurveys.question,
   status:hcmPulseSurveys.status,createdAt:hcmPulseSurveys.createdAt,
 }).from(hcmPulseSurveys).where(eq(hcmPulseSurveys.organizationId,organizationId))
   .orderBy(asc(hcmPulseSurveys.id)).limit(100);
 if(auth.user!.role==="employee")return Response.json({surveys:rows.filter(row=>row.status==="open")},
   {headers:PRIVATE});
 const closed=rows.filter(row=>row.status==="closed");
 const results=[];
 for(const survey of closed) {
  const responses=await db.select({score:hcmPulseSurveyResponses.score})
    .from(hcmPulseSurveyResponses).where(and(
      eq(hcmPulseSurveyResponses.organizationId,organizationId),
      eq(hcmPulseSurveyResponses.surveyId,survey.id),
    )).limit(50_001);
  if(responses.length>50_000)continue;
  const aggregate=aggregateClosedPulse({status:"closed",scores:responses.map(r=>r.score)});
  results.push({surveyId:survey.id,...aggregate});
 }
 return Response.json({surveys:rows,results,
  privacy:"Results only after closure with at least five responses. No responder IDs or individual answers."},
  {headers:PRIVATE});
}
export async function POST(request:Request){
 const origin=enforceSameOriginMutation(request);if(origin)return origin;
 const body=await request.json().catch(()=>({}));
 const organizationId=Number(body.organizationId);
 const auth=await scope(organizationId);if(auth.error)return auth.error;
 const action=String(body.action??"");
 const limit=await enforceSensitiveActionRateLimit(request,{userId:auth.user!.id,
    action:"engagement-"+action,resourceId:organizationId,limit:30,windowMs:300_000});
 if(limit)return limit;
 if(action==="respond"){
  if(auth.user!.role!=="employee"||!auth.user!.employeeId)
   return Response.json({error:"Linked employee required."},{status:403});
  const surveyId=Number(body.surveyId),score=Number(body.score);
  if(!Number.isSafeInteger(surveyId)||surveyId<1||!Number.isSafeInteger(score)||score<1||score>5)
   return Response.json({error:"Survey and 1-5 score required."},{status:400});
  const [employee]=await db.select({id:employees.id}).from(employees).where(and(
    eq(employees.id,auth.user!.employeeId),eq(employees.organizationId,organizationId),
  )).limit(1);
  if(!employee)return Response.json({error:"Employee scope invalid."},{status:403});
  const secret=process.env.HCM_SURVEY_ANONYMITY_KEY??"";
  let hash:string;
  try{hash=anonymousSurveyResponderHash({
    organizationId,surveyId,userId:auth.user!.id,secret,
  });}catch{return Response.json({error:"Anonymous survey security not configured."},{status:503});}
  const result=await db.transaction(async tx=>{
    const [survey]=await tx.select().from(hcmPulseSurveys).where(and(
      eq(hcmPulseSurveys.id,surveyId),
      eq(hcmPulseSurveys.organizationId,organizationId),
    )).for("update").limit(1);
    if(!survey||survey.status!=="open")return "closed";
    const [record]=await tx.insert(hcmPulseSurveyResponses).values({
      organizationId,surveyId,respondentHash:hash,score,
    }).onConflictDoNothing().returning({id:hcmPulseSurveyResponses.id});
    return record?"recorded":"duplicate";
  });
  return Response.json({status:result,
    note:result==="recorded"?"Anonymous response received. Individual answers are never shown.":undefined},
    {status:result==="closed"?409:result==="duplicate"?409:201,headers:PRIVATE});
 }
 const denied=await admin(auth.user!.id,organizationId);if(denied)return denied;
 const mfa=requireSensitiveActionMfa(auth.user!);if(mfa)return mfa;
 if(action==="create"){
  const question=String(body.question??"").trim().slice(0,240);
  if(question.length<10)return Response.json({error:"A meaningful 10-240 character question is required."},{status:400});
  const row=await db.transaction(async tx=>{
    const [created]=await tx.insert(hcmPulseSurveys).values({
      organizationId,question,createdByUserId:auth.user!.id,
    }).returning({id:hcmPulseSurveys.id});
    await tx.insert(auditEvents).values({organizationId,actor:auth.user!.name,
      action:"Anonymous employee pulse survey created",resource:"Engagement pulse",
      metadata:{surveyId:created.id}});
    return created;
  });
  return Response.json({surveyId:row.id,status:"open"},{status:201});
 }
 if(action==="close"){
  const surveyId=Number(body.surveyId);
  if(!Number.isSafeInteger(surveyId)||surveyId<1)
    return Response.json({error:"Valid survey id required."},{status:400});
  const row=await db.transaction(async tx=>{
    const [closed]=await tx.update(hcmPulseSurveys).set({status:"closed",closedAt:new Date()})
      .where(and(eq(hcmPulseSurveys.organizationId,organizationId),
       eq(hcmPulseSurveys.id,surveyId),eq(hcmPulseSurveys.status,"open")))
      .returning({id:hcmPulseSurveys.id});
    if(!closed)return null;
    await tx.insert(auditEvents).values({organizationId,actor:auth.user!.name,
      action:"Anonymous employee pulse survey closed",resource:"Engagement pulse",
      metadata:{surveyId}});
    return closed;
  });
  if(!row)return Response.json({error:"Survey not open."},{status:409});
  return Response.json({surveyId,status:"closed",
    note:"Sealed survey aggregate available only if five or more responses exist."});
 }
 return Response.json({error:"Unsupported survey action."},{status:400});
}
