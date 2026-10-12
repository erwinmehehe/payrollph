import { getAccess, assertOrganizationRole, WORKFORCE_MANAGER_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { phWorkDateAt } from "@/lib/workforce-manager-actions";
import { previewEmployerGreedyRoster } from "@/lib/workforce-greedy-roster-server";

export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store"};
function dateOrdinal(value:string):number|null{
  if(!/^\d{4}-\d\d-\d\d$/.test(value))return null;
  const ms=Date.parse(value+"T00:00:00Z");
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)return null;
  return Math.floor(ms/86_400_000);
}

export async function GET(request:Request) {
  if(!criticalReleaseFlagEnabled("wfmGreedyRoster")){
    return Response.json({error:"Greedy roster previews are disabled."},{status:404,headers:noStore});
  }
  const user=await getSessionUser();
  if(!user)return Response.json({error:"Unauthorized."},{status:401,headers:noStore});
  const url=new URL(request.url);
  const organizationId=Number(url.searchParams.get("organizationId"));
  const worksiteId=Number(url.searchParams.get("worksiteId"));
  const startDate=String(url.searchParams.get("startDate")??"");
  const endDate=String(url.searchParams.get("endDate")??"");
  const start=dateOrdinal(startDate),end=dateOrdinal(endDate),today=dateOrdinal(phWorkDateAt());
  if(!Number.isSafeInteger(organizationId)||organizationId<=0||organizationId>2147483647||
     !Number.isSafeInteger(worksiteId)||worksiteId<=0||worksiteId>2147483647||
     start===null||end===null||today===null||start<=today||end<start||end-start>=14) {
    return Response.json({error:"Select an employer, authorized worksite, and 1-14 future Philippine work dates."},
      {status:400,headers:noStore});
  }
  const denied=await assertOrganizationRole(user.id,organizationId,WORKFORCE_MANAGER_ROLES,
    "Only workforce managers may generate scoped roster suggestions.");
  if(denied)return denied;
  const access=await getAccess(user.id,organizationId);
  if(!access||(!access.companyWide&&access.orgUnitId===null)){
    return Response.json({error:"No active workforce scope."},{status:403,headers:noStore});
  }
  try{
    const preview=await previewEmployerGreedyRoster({
      organizationId,worksiteId,startDate,endDate,
      companyWide:access.companyWide,scopeOrgUnitId:access.orgUnitId,
    });
    return Response.json(preview,{status:200,headers:noStore});
  }catch(error){
    return Response.json({
      error:error instanceof Error?error.message:"Verified staffing evidence could not be loaded.",
      code:"WFM_GREEDY_ROSTER_SOURCE_REVIEW",
      automaticallyPublished:false,
    },{status:409,headers:noStore});
  }
}
