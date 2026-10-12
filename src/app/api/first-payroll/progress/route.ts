import { getSessionUser } from "@/lib/auth";
import { assertMembership, getAccess } from "@/lib/access";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { isJourneyKey, readJourneyProgress, saveJourneyProgress } from "@/lib/first-payroll-progress";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const user=await getSessionUser(); if(!user)return Response.json({error:"Sign in required"},{status:401});
 const organizationId=Number(new URL(request.url).searchParams.get("organizationId"));
 if(!Number.isSafeInteger(organizationId)||organizationId<=0)return Response.json({error:"Invalid employer"},{status:400});
 const denied=await assertMembership(user.id,organizationId);if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Company-wide access required"},{status:403});
 return Response.json({ progress:await readJourneyProgress(organizationId) });
}
export async function PATCH(request:Request) {
 const origin=enforceSameOriginMutation(request); if(origin)return origin;
 const user=await getSessionUser();if(!user)return Response.json({error:"Sign in required"},{status:401});
 const body=await request.json().catch(()=>({}));const organizationId=Number(body.organizationId);
 if(!Number.isSafeInteger(organizationId)||organizationId<=0||!isJourneyKey(body.key))return Response.json({error:"Invalid employer or step"},{status:400});
 const denied=await assertMembership(user.id,organizationId);if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide)return Response.json({error:"Company-wide access required"},{status:403});
 if(body.action!=="handoff"&&body.action!=="time_review")return Response.json({error:"Invalid action"},{status:422});
 try { await saveJourneyProgress({organizationId,userId:user.id,userName:user.name,role:access.role,key:body.key,action:body.action,targetRole:body.targetRole});
  return Response.json({progress:await readJourneyProgress(organizationId)}); }
 catch(error){return Response.json({error:error instanceof Error?error.message:"Could not update journey"},{status:403});}
}
