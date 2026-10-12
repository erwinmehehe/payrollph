import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { EmployeePulsePanel } from "@/components/workspace/employee-pulse-panel";

export default async function EngagementPage({
 searchParams,
}:{searchParams:Promise<{organizationId?:string}>}){
 const user=await getSessionUser();
 if(!user)return <p>Sign in to access this module.</p>;
 if(!criticalReleaseFlagEnabled("hcmEngagementSurvey"))
   return <p>This module is not enabled.</p>;
 const params=await searchParams;
 const organizationId=Number(params.organizationId??0);
 if(!Number.isSafeInteger(organizationId)||organizationId<1)return <p>Select an employer first.</p>;
 return <EmployeePulsePanel organizationId={organizationId}/>;
}
