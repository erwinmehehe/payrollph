import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { automationExecutions, hcmBusinessProcessInstances, hcmBusinessProcessInstanceSteps } from "@/db/schema";

export function approvalSourceLinksOwned(
  organizationId: number,
  hcm: Array<{ organizationId: number; instanceOrganizationId: number | null }>,
  automation: Array<{ organizationId: number }>,
): boolean {
  return Number.isSafeInteger(organizationId) && organizationId > 0
    && hcm.length <= 1 && automation.length <= 1
    && hcm.every(row => row.organizationId === organizationId && row.instanceOrganizationId === organizationId)
    && automation.every(row => row.organizationId === organizationId);
}

/** A task's membership check cannot authorize reverse foreign-key links.
 * Read only ownership columns, bounded to detect ambiguous links, in the same
 * transaction BEFORE deciding the task or advancing any connected workflow.
 */
export async function approvalSourceTenantBoundary(
  tx: Pick<typeof db, "select">,
  taskId: number,
  organizationId: number,
): Promise<boolean> {
  const [hcm, automation] = await Promise.all([
    tx.select({ organizationId: hcmBusinessProcessInstanceSteps.organizationId,
      instanceOrganizationId: hcmBusinessProcessInstances.organizationId })
      .from(hcmBusinessProcessInstanceSteps)
      .leftJoin(hcmBusinessProcessInstances, eq(hcmBusinessProcessInstances.id, hcmBusinessProcessInstanceSteps.instanceId))
      .where(eq(hcmBusinessProcessInstanceSteps.approvalTaskId, taskId)).limit(2),
    tx.select({ organizationId: automationExecutions.organizationId }).from(automationExecutions)
      .where(eq(automationExecutions.waitingApprovalTaskId, taskId)).limit(2),
  ]);
  return approvalSourceLinksOwned(organizationId, hcm, automation);
}
