import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@/db";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.HCM_SLA_CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || !supplied) return false;
  const a = Buffer.from(secret), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by a scheduler. Durable, idempotent, and deliberately does not mutate any source payroll data. */
export async function POST(request: NextRequest) {
  if (!process.env.HCM_SLA_CRON_SECRET) return Response.json({ error: "SLA scheduler not configured." }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      WITH due AS (
        SELECT id FROM automation_operational_cases
        WHERE status <> 'resolved' AND escalated_at IS NULL
          AND sla_due_at < now() AND sla_escalate_at IS NOT NULL
          AND sla_escalate_at <= now()
        ORDER BY sla_escalate_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED
      )
      UPDATE automation_operational_cases c
      SET escalated_at = now(), escalation_level = 1, updated_at = now()
      FROM due WHERE c.id = due.id
      RETURNING c.id, c.organization_id, c.owner_team, c.assigned_owner_user_id, c.sla_due_at, c.escalated_at
    `);
    for (const item of result.rows) {
      await client.query(`INSERT INTO hcm_work_item_events
        (organization_id, case_id, event_type, next_value)
        VALUES ($1,$2,'sla_escalated',$3::jsonb)`, [
          item.organization_id, item.id,
          JSON.stringify({ level: 1, team: item.owner_team, ownerUserId: item.assigned_owner_user_id, dueAt: item.sla_due_at, escalatedAt: item.escalated_at }),
        ]);
    }
    await client.query("COMMIT");
    return Response.json({ escalated: result.rowCount, remainingMayExist: result.rowCount === 100 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("HCM SLA sweep failed", error);
    return Response.json({ error: "Escalation sweep failed." }, { status: 500 });
  } finally { client.release(); }
}
