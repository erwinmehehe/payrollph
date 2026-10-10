import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { loadMonitor } from "@/lib/hcm-bp-monitor-server";
export const dynamic="force-dynamic";
function json(x:unknown,status=200){return Response.json(x,{status,headers:{"Cache-Control":"private, no-store"}});}
function id(s:string|null){if(!s||!/^\d+$/.test(s))return null;const n=Number(s);return Number.isSafeInteger(n)&&n>0?n:null;}
export async function GET(request:Request){
 if(process.env.HCM_BP_MONITOR_ENABLED!=="true")return json({error:"Not found"},404);
 const user=await getSessionUser();if(!user)return json({error:"Authentication required"},401);
 const params=new URL(request.url).searchParams,organizationId=id(params.get("organizationId")),raw=params.get("beforeId");
 if(!organizationId || (raw!==null && !id(raw)))return json({error:"Invalid query"},400);
 const denied=await assertOrganizationRole(user.id,organizationId,PEOPLE_ADMIN_ROLES);if(denied)return denied;
 const access=await getAccess(user.id,organizationId);
 if(!access?.companyWide||!["owner","admin","hr"].includes(access.role))return json({error:"HR access required"},403);
 try{return json(await loadMonitor(organizationId,raw?id(raw):null));}
 catch{return json({error:"Monitor source unavailable"},503);}
}
