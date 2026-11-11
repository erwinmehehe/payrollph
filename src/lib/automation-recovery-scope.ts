import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { automationExecutions, automationRules, employees } from "@/db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Execution = typeof automationExecutions.$inferSelect;

/** Hold the stored execution and its employer bindings throughout recovery.
 * Share locks prevent a worker transfer or rule reassignment after validation.
 * Missing references are not equivalent to a verified employer-owned resource.
 */
export async function lockAutomationRecoveryScope(
  tx: Transaction,
  organizationId: number,
  executionId: number,
): Promise<Execution> {
  const [execution] = await tx.select().from(automationExecutions).where(and(
    eq(automationExecutions.id, executionId),
    eq(automationExecutions.organizationId, organizationId),
  )).for("update").limit(1);
  if (!execution) throw new Error("Automation execution not found.");

  const [rule] = await tx.select({ id: automationRules.id }).from(automationRules).where(and(
    eq(automationRules.id, execution.ruleId),
    eq(automationRules.organizationId, organizationId),
  )).for("share").limit(1);
  if (!rule) throw new Error("Stored automation recovery scope is invalid.");

  if (execution.employeeId != null) {
    const [worker] = await tx.select({ id: employees.id }).from(employees).where(and(
      eq(employees.id, execution.employeeId),
      eq(employees.organizationId, organizationId),
    )).for("share").limit(1);
    if (!worker) throw new Error("Stored automation recovery scope is invalid.");
  }
  return execution;
}
