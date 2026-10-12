import { getSessionUser } from "@/lib/auth";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { OfflinePunchReviewPanel } from "@/components/workspace/offline-punch-review";
export default async function OfflinePunchReviewPage({
 searchParams,
}:{searchParams:Promise<{organizationId?:string}>}){
 const user=await getSessionUser();
 if(!user)return <p>Sign in to review attendance evidence.</p>;
 if(!criticalReleaseFlagEnabled("wfmOfflinePunchQueue"))return <p>Offline evidence review is not enabled.</p>;
 const params=await searchParams;
 const organizationId=Number(params.organizationId??0);
 if(!Number.isSafeInteger(organizationId)||organizationId<1)return <p>Select an employer first.</p>;
 return <OfflinePunchReviewPanel organizationId={organizationId}/>;
}
