import { getSessionUser } from "@/lib/auth";
import { denyOptInEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-server";
import {
  denyHcmOrgExplorer, hcmOrgExplorerEnabledForEmployer, hcmOrgExplorerJson, hcmOrgExplorerSingleQueryId,
} from "@/lib/hcm-org-explorer-access";
import { loadHcmOrgExplorer, OrgExplorerPreviewLimitError } from "@/lib/hcm-org-explorer-server";

export const dynamic = "force-dynamic";

/** Current recorded organization and position sources; never writes HR data. */
export async function GET(request: Request) {
  if (process.env.HCM_ORG_EXPLORER_ENABLED !== "true") {
    return hcmOrgExplorerJson({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return hcmOrgExplorerJson({ error: "Authentication required." }, 401);

  // A duplicated employer selector is ambiguous even when its first value is authorized.
  const params = new URL(request.url).searchParams;
  const organizationId = hcmOrgExplorerSingleQueryId(params, "organizationId");
  if (!organizationId) return hcmOrgExplorerJson({ error: "Valid organizationId required." }, 400);

  if (!hcmOrgExplorerEnabledForEmployer(organizationId)) return hcmOrgExplorerJson({ error: "Not found." }, 404);

  const denied = await denyHcmOrgExplorer(user.id, organizationId);
  if (denied) return hcmOrgExplorerJson({ error: "Workspace access denied." }, denied.status);
  const enterpriseDenied = await denyOptInEnterpriseHcmPlan(organizationId);
  if (enterpriseDenied) return enterpriseDenied;

  try {
    return hcmOrgExplorerJson(await loadHcmOrgExplorer(organizationId));
  } catch (error) {
    if (error instanceof OrgExplorerPreviewLimitError) {
      return hcmOrgExplorerJson({
        error: "Organization sources exceed this pilot view's bounded preview. Use the authoritative People/Planning source.",
      }, 409);
    }
    return hcmOrgExplorerJson({ error: "Organization source unavailable." }, 503);
  }
}
