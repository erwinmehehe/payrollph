import { getSessionUser } from "@/lib/auth";
import {
  denyHcmOrgExplorer, hcmOrgExplorerJson, hcmOrgExplorerPositiveId,
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

  const organizationId = hcmOrgExplorerPositiveId(
    new URL(request.url).searchParams.get("organizationId"),
  );
  if (!organizationId) return hcmOrgExplorerJson({ error: "Valid organizationId required." }, 400);

  const denied = await denyHcmOrgExplorer(user.id, organizationId);
  if (denied) return denied;

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
