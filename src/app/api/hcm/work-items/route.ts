import { NextRequest } from "next/server";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { pool } from "@/db";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, PEOPLE_ADMIN_ROLES, getAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

const TEAMS = new Set(["HR Operations", "Payroll", "Timekeeping", "Compliance", "Employee Relations", "Benefits", "People Operations"]);
const ACTIVE = new Set(["open", "acknowledged"]);
const validId = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

async function authorize(organizationId: number) {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ error: "Sign in required." }, { status: 401 }) };
  const denied = await assertOrganizationRole(user.id, organizationId, PEOPLE_ADMIN_ROLES);
  if (denied) return { error: denied };
  const access = await getAccess(user.id, organizationId);
  if (!access?.companyWide) return { error: Response.json({ error: "Company-wide HR access required for operational case queue." }, { status: 403 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const organizationId = Number(request.nextUrl.searchParams.get("organizationId"));
  if (!validId(organizationId)) return Response.json({ error: "Valid organizationId required." }, { status: 400 });
  const auth = await authorize(organizationId);
  if (auth.error) return auth.error;
  const status = request.nextUrl.searchParams.get("status");
  if (status && !["open", "acknowledged", "resolved", "overdue"].includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });
  const result = await pool.query(`
    SELECT c.id, c.organization_id AS "organizationId", c.case_type AS "caseType", c.title, c.detail,
           c.owner_team AS "ownerTeam", c.assigned_owner_user_id AS "ownerUserId",
           u.name AS "ownerName", c.status, c.created_at AS "createdAt",
           c.sla_due_at AS "dueAt", c.sla_escalate_at AS "escalateAt",
           c.escalated_at AS "escalatedAt", c.escalation_level AS "escalationLevel",
           (c.status <> 'resolved' AND c.sla_due_at < now()) AS "overdue"
    FROM automation_operational_cases c
    LEFT JOIN users u ON u.id = c.assigned_owner_user_id
    WHERE c.organization_id = $1
      AND ($2::text IS NULL OR ($2 = 'overdue' AND c.status <> 'resolved' AND c.sla_due_at < now()) OR c.status = $2)
    ORDER BY (c.status <> 'resolved' AND c.sla_due_at < now()) DESC, c.sla_due_at ASC NULLS LAST, c.created_at DESC
    LIMIT 200`, [organizationId, status]);
  const owners = await pool.query("SELECT u.id, u.name FROM user_organizations uo JOIN users u ON u.id = uo.user_id WHERE uo.organization_id=$1 AND uo.active=true AND u.active=true AND uo.role IN ('owner','admin','bookkeeper','hr') ORDER BY u.name LIMIT 200", [organizationId]);
  return Response.json({ items: result.rows, owners: owners.rows });
}

export async function PATCH(request: NextRequest) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return Response.json({ error: "Valid JSON required." }, { status: 400 }); }
  const organizationId = Number(input.organizationId), id = Number(input.id);
  if (!validId(organizationId) || !validId(id)) return Response.json({ error: "Valid organizationId and id required." }, { status: 400 });
  const auth = await authorize(organizationId);
  if (auth.error) return auth.error;
  const ownerTeam = input.ownerTeam;
  const ownerUserId = input.ownerUserId;
  const dueAt = input.dueAt;
  const escalateAt = input.escalateAt;
  if (ownerTeam !== undefined && (typeof ownerTeam !== "string" || !TEAMS.has(ownerTeam))) return Response.json({ error: "Invalid accountable team." }, { status: 400 });
  if (ownerUserId !== undefined && ownerUserId !== null && !validId(ownerUserId)) return Response.json({ error: "Invalid owner." }, { status: 400 });
  const parseDate = (v: unknown) => v === null ? null : typeof v === "string" && v.trim() && Number.isFinite(Date.parse(v)) ? new Date(v) : undefined;
  const due = dueAt === undefined ? undefined : parseDate(dueAt);
  const escalation = escalateAt === undefined ? undefined : parseDate(escalateAt);
  if ((dueAt !== undefined && due === undefined) || (escalateAt !== undefined && escalation === undefined)) return Response.json({ error: "Invalid ISO deadline." }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const beforeResult = await client.query("SELECT * FROM automation_operational_cases WHERE organization_id = $1 AND id = $2 FOR UPDATE", [organizationId, id]);
    const before = beforeResult.rows[0];
    if (!before) { await client.query("ROLLBACK"); return Response.json({ error: "Work item not found." }, { status: 404 }); }
    if (!ACTIVE.has(before.status)) { await client.query("ROLLBACK"); return Response.json({ error: "Resolved cases cannot be reassigned." }, { status: 409 }); }
    const nextTeam = ownerTeam === undefined ? before.owner_team : ownerTeam;
    const nextOwner = ownerUserId === undefined ? before.assigned_owner_user_id : ownerUserId;
    const nextDue = due === undefined ? before.sla_due_at : due;
    const nextEscalation = escalation === undefined ? before.sla_escalate_at : escalation;
    if (nextEscalation && (!nextDue || new Date(nextEscalation).getTime() < new Date(nextDue).getTime())) {
      await client.query("ROLLBACK"); return Response.json({ error: "Escalation must be on or after the due date." }, { status: 400 });
    }
    if (nextOwner !== null) {
      const member = await client.query("SELECT 1 FROM user_organizations uo JOIN users u ON u.id = uo.user_id WHERE uo.user_id = $1 AND uo.organization_id = $2 AND uo.active = true AND u.active = true AND uo.role IN ('owner','admin','bookkeeper','hr') LIMIT 1", [nextOwner, organizationId]);
      if (!member.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Owner must be an active HR-authorized member of this workspace." }, { status: 400 }); }
    }
    const updated = await client.query(`UPDATE automation_operational_cases SET owner_team=$3, assigned_owner_user_id=$4, sla_due_at=$5, sla_escalate_at=$6,
      escalated_at = CASE WHEN sla_due_at IS DISTINCT FROM $5::timestamptz OR sla_escalate_at IS DISTINCT FROM $6::timestamptz THEN NULL ELSE escalated_at END,
      escalation_level = CASE WHEN sla_due_at IS DISTINCT FROM $5::timestamptz OR sla_escalate_at IS DISTINCT FROM $6::timestamptz THEN 0 ELSE escalation_level END,
      updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, id, nextTeam, nextOwner, nextDue, nextEscalation]);
    await client.query("INSERT INTO hcm_work_item_events (organization_id,case_id,event_type,actor_user_id,previous_value,next_value) VALUES($1,$2,'ownership_sla_updated',$3,$4::jsonb,$5::jsonb)", [organizationId,id,auth.user!.id,JSON.stringify({ ownerTeam: before.owner_team, ownerUserId: before.assigned_owner_user_id, dueAt: before.sla_due_at, escalateAt: before.sla_escalate_at }),JSON.stringify({ ownerTeam: nextTeam, ownerUserId: nextOwner, dueAt: nextDue, escalateAt: nextEscalation })]);
    await client.query("COMMIT");
    return Response.json({ item: updated.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); console.error("Work item update failed",error); return Response.json({ error: "Unable to update work item." }, { status: 500 }); } finally { client.release(); }
}
