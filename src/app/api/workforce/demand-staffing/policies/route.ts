import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobProfiles, worksites } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation, enforceSensitiveActionRateLimit, requireSensitiveActionMfa,
} from "@/lib/security-request";
import { validReceiptId } from "@/lib/workforce-schedule-receipt";
import { operationalDemandSiteAuthorized } from "@/lib/workforce-operational-demand-scope";
import { issuedDemandPilotAllowed } from "@/lib/workforce-issued-demand-validation";
import {
  staffingPolicyPilotAllowed, parseStaffingPolicyDraft,
  parseStaffingPolicyTransition,
} from "@/lib/workforce-demand-staffing-policy";
import {
  createStaffingPolicyDraft, transitionStaffingPolicy, readStaffingPolicies,
  StaffingPolicyConflict, StaffingPolicyUnauthorized,
} from "@/lib/workforce-demand-staffing-policy-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const metrics = ["transactions","visits","orders","appointments","calls"];

async function verifiedSite(org:number,site:number,access:{
  organizationId:number;companyWide:boolean;orgUnitId:number|null;
}) {
  const [row]=await db.select({
    organizationId:worksites.organizationId,orgUnitId:worksites.orgUnitId,
    active:worksites.active,timezone:worksites.timezone,
  }).from(worksites).where(and(
    eq(worksites.organizationId,org),eq(worksites.id,site),
  )).limit(1);
  return !!row && operationalDemandSiteAuthorized(access,row) &&
    row.timezone==="Asia/Manila";
}

export async function GET(request:Request) {
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const p=new URL(request.url).searchParams;
  const organizationId=Number(p.get("organizationId")??"");
  const worksiteId=Number(p.get("worksiteId")??"");
  const roleParam=p.get("jobProfileId");
  const jobProfileId=roleParam==="any"?null:Number(roleParam??"");
  const metricKind=p.get("metricKind")??"";
  const intervalMinutes=Number(p.get("intervalMinutes")??"");
  const mode=p.get("mode")==="manage"?"manage":"approved";
  if(!validReceiptId(organizationId)||!validReceiptId(worksiteId)||
    (jobProfileId!==null&&!validReceiptId(jobProfileId))||
    !metrics.includes(metricKind)||![15,30,60].includes(intervalMinutes)) {
    return Response.json({error:"Exact worksite, role and demand metric are required."},{status:400,headers});
  }
  // Deny a revoked session or a custom workforce permission restriction
  // before inspecting tenant pilot flags, sites, roles or policy evidence.
  const roleDenied=await assertOrganizationRole(
    user.id,organizationId,WORKFORCE_MANAGER_ROLES,
    "Workforce policy review requires scoped manager access.");
  if(roleDenied)return roleDenied;
  const access=await getAccess(user.id,organizationId);
  if(!access||(mode==="manage"&&(!access.companyWide||
       !PEOPLE_ADMIN_ROLES.some(role=>role===access.role)))) {
    return Response.json({error:"Workforce policy review requires scoped manager access."},{status:403,headers});
  }
  if(!staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))){
    return Response.json({error:"Demand staffing policies unavailable for employer."},{status:404,headers});
  }
  try {
    if(!await verifiedSite(organizationId,worksiteId,access)) {
      return Response.json({error:"Worksite unavailable in current employer scope."},{status:403,headers});
    }
    if(jobProfileId!==null) {
      const [role]=await db.select({id:jobProfiles.id}).from(jobProfiles).where(and(
        eq(jobProfiles.organizationId,organizationId),
        eq(jobProfiles.id,jobProfileId),eq(jobProfiles.active,true),
      )).limit(1);
      if(!role)return Response.json({error:"Job profile unavailable in employer."},{status:403,headers});
    }
    const policies=await readStaffingPolicies({
      organizationId,worksiteId,jobProfileId,
      metricKind:metricKind as "transactions"|"visits"|"orders"|"appointments"|"calls",
      intervalMinutes:intervalMinutes as 15|30|60,mode,
    });
    return Response.json({
      readOnly:true,scope:{organizationId,worksiteId,jobProfileId,metricKind,intervalMinutes},
      policies, boundary:"Only independently approved, hash-verified, exact-scope policies may inform advisory staffing scenarios. No roster or payroll write.",
    },{headers});
  } catch {
    return Response.json({error:"Policy evidence unavailable or migration not approved."},{status:503,headers});
  }
}

export async function POST(request:Request) {
  const denied=enforceSameOriginMutation(request);if(denied)return denied;
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const demo=publicDemoMutationDenied(user.email,"Demand staffing policy proposal");if(demo)return demo;
  const raw=await request.text().catch(()=>"");
  if(Buffer.byteLength(raw,"utf8")>4096)return Response.json({error:"Policy proposal too large."},{status:413,headers});
  let spec;
  try{spec=parseStaffingPolicyDraft(JSON.parse(raw));}
  catch{return Response.json({error:"Invalid exact-scope policy proposal."},{status:400,headers});}
  if(!staffingPolicyPilotAllowed(spec.organizationId,issuedDemandPilotAllowed(spec.organizationId))){
    return Response.json({error:"Employer policy pilot disabled."},{status:404,headers});
  }
  const access=await getAccess(user.id,spec.organizationId);
  if(!access||!access.companyWide||!PEOPLE_ADMIN_ROLES.some(role=>role===access.role)){
    return Response.json({error:"Company-wide People admin access required."},{status:403,headers});
  }
  const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
  const limited=await enforceSensitiveActionRateLimit(request,{
    userId:user.id,action:"wfm-staffing-policy-propose",
    resourceId:spec.organizationId,limit:8,windowMs:300000,
  });if(limited)return limited;
  try {
    const result=await createStaffingPolicyDraft({
      spec,actorUserId:user.id,access,
    });
    return Response.json({...result,readOnlyProposal:true,
      boundary:"Creating this proposal does not approve staffing rules, shifts or payroll.",
    },{status:result.replayed?200:201,headers});
  } catch(e) {
    if(e instanceof StaffingPolicyUnauthorized)return Response.json({error:e.message},{status:403,headers});
    if(e instanceof StaffingPolicyConflict)return Response.json({error:e.message},{status:409,headers});
    return Response.json({error:"Policy storage or approved migration unavailable."},{status:503,headers});
  }
}

export async function PATCH(request:Request) {
  const denied=enforceSameOriginMutation(request);if(denied)return denied;
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Authentication required."},{status:401,headers});
  const demo=publicDemoMutationDenied(user.email,"Demand staffing policy decision");if(demo)return demo;
  const raw=await request.text().catch(()=>"");
  if(Buffer.byteLength(raw,"utf8")>2048)return Response.json({error:"Policy decision too large."},{status:413,headers});
  let change;
  try{change=parseStaffingPolicyTransition(JSON.parse(raw));}
  catch{return Response.json({error:"Invalid policy transition."},{status:400,headers});}
  if(!staffingPolicyPilotAllowed(change.organizationId,issuedDemandPilotAllowed(change.organizationId))){
    return Response.json({error:"Employer policy pilot disabled."},{status:404,headers});
  }
  const access=await getAccess(user.id,change.organizationId);
  if(!access||!access.companyWide||!PEOPLE_ADMIN_ROLES.some(role=>role===access.role)){
    return Response.json({error:"Company-wide People admin access required."},{status:403,headers});
  }
  if(change.action!=="submit"&&!["owner","admin"].includes(access.role)){
    return Response.json({error:"Owner/admin independent decision required."},{status:403,headers});
  }
  const mfa=requireSensitiveActionMfa(user);if(mfa)return mfa;
  const limited=await enforceSensitiveActionRateLimit(request,{
    userId:user.id,action:"wfm-staffing-policy-"+change.action,
    resourceId:change.organizationId,limit:8,windowMs:300000,
  });if(limited)return limited;
  try {
    const result=await transitionStaffingPolicy({
      change,actorUserId:user.id,actorRole:access.role,access,
    });
    return Response.json({...result,
      boundary:"Approval authorizes an effective-dated planning rule only; never schedules or payroll.",
    },{headers});
  } catch(e) {
    if(e instanceof StaffingPolicyUnauthorized)return Response.json({error:e.message},{status:403,headers});
    if(e instanceof StaffingPolicyConflict)return Response.json({error:e.message},{status:409,headers});
    return Response.json({error:"Policy transition unavailable or not yet migrated."},{status:503,headers});
  }
}
