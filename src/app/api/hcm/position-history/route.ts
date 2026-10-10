import { getSessionUser } from "@/lib/auth";
import {
  denyHcmOrgExplorer, hcmOrgExplorerJson, hcmOrgExplorerPositiveId,
} from "@/lib/hcm-org-explorer-access";
import { loadHcmPositionHistory } from "@/lib/hcm-org-explorer-server";

export const dynamic = "force-dynamic";

/** Effective-dated source history only: no payroll or worker mutation. */
export async function GET(request: Request) {
  if (process.env.HCM_ORG_EXPLORER_ENABLED !== "true") {
    return hcmOrgExplorerJson({ error: "Not found." }, 404);
  }
  const user = await getSessionUser();
  if (!user) return hcmOrgExplorerJson({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = hcmOrgExplorerPositiveId(params.get("organizationId"));
  const positionId = hcmOrgExplorerPositiveId(params.get("positionId"));
  if (!organizationId || !positionId) {
    return hcmOrgExplorerJson({ error: "Valid organizationId and positionId required." }, 400);
  }

  const denied = await denyHcmOrgExplorer(user.id, organizationId);
  if (denied) return denied;
  try {
    const result = await loadHcmPositionHistory(organizationId, positionId);
    if (!result) return hcmOrgExplorerJson({ error: "Position not found in this employer." }, 404);
    return hcmOrgExplorerJson(result);
  } catch {
    return hcmOrgExplorerJson({ error: "Position source unavailable." }, 503);
  }
}
