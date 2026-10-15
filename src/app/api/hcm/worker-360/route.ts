import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { denyOptInEnterpriseHcmPlan } from "@/lib/hcm-enterprise-plan-server";
import {
  philippineWorker360Date, validWorker360Date, validWorker360EventCursor,
  type Worker360EventCursor,
} from "@/lib/hcm-worker-360-projection";
import { loadWorker360Summary } from "@/lib/hcm-worker-360-server";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStore });
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Read-only by design. All worker, position and payroll writes remain upstream. */
export async function GET(request: Request) {
  // This server-only kill switch must be explicitly enabled after acceptance.
  if (process.env.HCM_WORKER_360_ENABLED !== "true") return json({ error: "Not found." }, 404);

  const user = await getSessionUser();
  if (!user) return json({ error: "Authentication required." }, 401);

  const params = new URL(request.url).searchParams;
  const organizationId = positiveId(params.get("organizationId"));
  const employeeId = positiveId(params.get("employeeId"));
  if (!organizationId || !employeeId) return json({ error: "Valid organizationId and employeeId required." }, 400);
  const asOfDate = params.get("asOfDate") ?? philippineWorker360Date();
  if (!validWorker360Date(asOfDate)) return json({ error: "Valid asOfDate (YYYY-MM-DD) required." }, 400);

  // A cursor only orders existing authorized source records; it never selects
  // an employer or worker, and both parts must be supplied together.
  let before: Worker360EventCursor | undefined;
  if (params.has("beforeDate") || params.has("beforeId")) {
    const effectiveDate = params.get("beforeDate") ?? "";
    const id = positiveId(params.get("beforeId"));
    if (!id || !validWorker360EventCursor({ effectiveDate, id }, asOfDate)) {
      return json({ error: "Valid beforeDate and beforeId required for older events." }, 400);
    }
    before = { effectiveDate, id };
  }

  const denied = await assertOrganizationRole(
    user.id, organizationId, PEOPLE_ADMIN_ROLES,
    "Company-wide People administration is required.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  // PEOPLE_ADMIN_ROLES includes bookkeepers; that does NOT authorize Worker 360.
  // Nor may HR members scoped to one org unit see this company-wide projection.
  if (!access?.companyWide || !["owner", "admin", "hr"].includes(access.role)) {
    return json({ error: "Company-wide HR access required." }, 403);
  }

  const planDenied = await denyOptInEnterpriseHcmPlan(organizationId);
  if (planDenied) return planDenied;

  try {
    const summary = await loadWorker360Summary(organizationId, employeeId, asOfDate, before);
    if (!summary) return json({ error: "Worker not found in this employer." }, 404);
    return json(summary);
  } catch {
    // Fail closed; do not leak internal SQL, worker details or org identifiers.
    return json({ error: "Worker 360 source temporarily unavailable." }, 503);
  }
}
