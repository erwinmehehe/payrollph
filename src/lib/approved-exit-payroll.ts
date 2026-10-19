import { and, eq, or, sql } from "drizzle-orm";
import { employees, separationRecords } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** Include pending exits explicitly: missing approval must block, never omit pay silently. */
export function payrollEmploymentStatus(periodStart: string) {
  if (!criticalReleaseFlagEnabled("approvedExitPayroll")) return eq(employees.status, "Active");
  return or(eq(employees.status, "Active"), and(eq(employees.status, "Separating"), or(
    sql`exists (select 1 from ${separationRecords} where ${separationRecords.organizationId} = ${employees.organizationId} and ${separationRecords.employeeId} = ${employees.id} and ${separationRecords.lastDay} >= ${periodStart})`,
    sql`not exists (select 1 from ${separationRecords} where ${separationRecords.organizationId} = ${employees.organizationId} and ${separationRecords.employeeId} = ${employees.id})`,
  )));
}

/** Released capped wages may enter final-pay YTD only with the engine's exit trace. */
export function verifiedExitPayrollTrace(trace: unknown, lastDay: string, separationId: number) {
  if (!Number.isSafeInteger(separationId) || separationId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) return false;
  if (!trace || typeof trace !== "object") return false;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return false;
  return ["approvedExitProration=v1", `employmentEnd=${lastDay}`, `approvedSeparationId=${separationId}`]
    .every(value => inputs.includes(value) && inputs.filter(item => typeof item === "string" && item.startsWith(value.split("=")[0] + "=")).length === 1);
}
