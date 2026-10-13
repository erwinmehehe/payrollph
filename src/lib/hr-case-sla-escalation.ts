import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employeeHrCases } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/**
 * App-internal SLA signal. Not a statutory deadline, payroll approval, or
 * automatic reply to an employee. Keeps only case IDs, assigned role, and time
 * metadata in the sealed audit trail; case description/internal notes stay in
 * the HR access-controlled tables.
 */
export async function runDueHrCaseSlaEscalations(now = new Date()) {
  if (!criticalReleaseFlagEnabled("employeeHrCases")) {
    return { skipped: true as const, overdueRecorded: 0 };
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid HR SLA scheduler date");
  let cursor = 0;
  let overdueRecorded = 0;
  const activeStatuses = ["open", "in_progress", "waiting_employee"];
  for (;;) {
    const rows = await db.select({
      id: employeeHrCases.id, organizationId: employeeHrCases.organizationId,
    }).from(employeeHrCases).where(and(
      gt(employeeHrCases.id, cursor),
      inArray(employeeHrCases.status, activeStatuses),
      lt(employeeHrCases.slaDueAt, now),
    )).orderBy(asc(employeeHrCases.id)).limit(200);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    for (const item of rows) {
      const added = await db.transaction(async tx => {
        const [row] = await tx.select({
          id: employeeHrCases.id, organizationId: employeeHrCases.organizationId,
          assignedRole: employeeHrCases.assignedRole, slaDueAt: employeeHrCases.slaDueAt,
          status: employeeHrCases.status,
        }).from(employeeHrCases).where(and(
          eq(employeeHrCases.id, item.id),
          eq(employeeHrCases.organizationId, item.organizationId),
        )).for("update").limit(1);
        if (!row || !activeStatuses.includes(row.status) || row.slaDueAt >= now) return false;
        const [existing] = await tx.select({id: auditEvents.id}).from(auditEvents).where(and(
          eq(auditEvents.organizationId, row.organizationId),
          eq(auditEvents.action, "HR case internal SLA overdue"),
          sql`${auditEvents.metadata}->>'hrCaseId' = ${String(row.id)}`,
        )).limit(1);
        if (existing) return false;
        await tx.insert(auditEvents).values({
          organizationId: row.organizationId,
          actor: "System scheduler",
          action: "HR case internal SLA overdue",
          resource: "HR service case",
          metadata: { hrCaseId: row.id, assignedRole: row.assignedRole,
            dueAt: row.slaDueAt.toISOString(), internalTargetOnly: true },
        });
        return true;
      });
      if (added) overdueRecorded++;
    }
    if (rows.length < 200) break;
  }
  return { skipped: false as const, overdueRecorded };
}
