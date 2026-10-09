import { NextRequest } from "next/server";
import { pool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES, getAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawOrg = request.nextUrl.searchParams.get("organizationId");
  const rawCase = request.nextUrl.searchParams.get("caseId");
  const organizationId = Number(rawOrg);
  const caseId = Number(rawCase);
  if (!rawOrg || !rawCase || !Number.isSafeInteger(organizationId) || organizationId < 1 || !Number.isSafeInteger(caseId) || caseId < 1)
    return Response.json({ error: "Valid organizationId and caseId are required." }, { status: 400 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return Response.json({ error: "Company-wide HR access required." }, { status: 403 });
  const result = await pool.query(`
    SELECT e.id, e.event_type AS "eventType", e.actor_user_id AS "actorUserId",
           u.name AS "actorName", e.previous_value AS "previousValue",
           e.next_value AS "nextValue", e.created_at AS "createdAt"
    FROM hcm_work_item_events e
    JOIN automation_operational_cases c ON c.id=e.case_id AND c.organization_id=e.organization_id
    LEFT JOIN users u ON u.id=e.actor_user_id
    WHERE e.organization_id=$1 AND e.case_id=$2
    ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,[organizationId,caseId]);
  if (!result.rowCount) {
    const exists=await pool.query("SELECT 1 FROM automation_operational_cases WHERE id=$1 AND organization_id=$2", [caseId,organizationId]);
    if (!exists.rowCount) return Response.json({ error: "Case not found." }, { status: 404 });
  }
  return Response.json({ events: result.rows });
}
