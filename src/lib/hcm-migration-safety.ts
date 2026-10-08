import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employeePayRevisions,
  hcmBusinessProcessDefinitions,
  hcmBusinessProcessInstances,
  historicalPayrollEntries,
  payrollRuns,
  positionAssignments,
  workerEffectiveChanges,
} from "@/db/schema";

/**
 * Broad, deliberately conservative gate for one-time employee-master migration.
 * Importing history, leave balances or loans remains a separate workflow.
 * This preflight is not a concurrency barrier for unrelated API endpoints;
 * production DBA/HR signoff and a transactional import remain required.
 */
export async function employeeMasterMigrationBlockers(organizationId: number): Promise<string[]> {
  const [
    hirePolicies,
    payrollActivity,
    historicalPayroll,
    reviewedHcmActivity,
    effectiveChanges,
    positionHistory,
    payRevisions,
  ] = await Promise.all([
    db.select({ id: hcmBusinessProcessDefinitions.id })
      .from(hcmBusinessProcessDefinitions)
      .where(and(
        eq(hcmBusinessProcessDefinitions.organizationId, organizationId),
        eq(hcmBusinessProcessDefinitions.processType, "hire"),
      )).limit(1),
    db.select({ id: payrollRuns.id }).from(payrollRuns)
      .where(eq(payrollRuns.organizationId, organizationId)).limit(1),
    db.select({ id: historicalPayrollEntries.id }).from(historicalPayrollEntries)
      .where(eq(historicalPayrollEntries.organizationId, organizationId)).limit(1),
    db.select({ id: hcmBusinessProcessInstances.id }).from(hcmBusinessProcessInstances)
      .where(eq(hcmBusinessProcessInstances.organizationId, organizationId)).limit(1),
    db.select({ id: workerEffectiveChanges.id }).from(workerEffectiveChanges)
      .where(eq(workerEffectiveChanges.organizationId, organizationId)).limit(1),
    db.select({ id: positionAssignments.id }).from(positionAssignments)
      .where(eq(positionAssignments.organizationId, organizationId)).limit(1),
    db.select({ id: employeePayRevisions.id }).from(employeePayRevisions)
      .where(eq(employeePayRevisions.organizationId, organizationId)).limit(1),
  ]);

  const blockers: string[] = [];
  if (hirePolicies.length) blockers.push("A governed Hire business process is configured; use its approved hiring path.");
  if (payrollActivity.length) blockers.push("Payroll runs already exist; the employee master is no longer an untouched migration baseline.");
  if (historicalPayroll.length) blockers.push("Historical payroll is already imported; employee master changes require a reconciled correction.");
  if (reviewedHcmActivity.length) blockers.push("HCM business processes have already started; a CSV cannot rewrite their worker evidence.");
  if (effectiveChanges.length) blockers.push("Effective-dated HCM worker changes exist; a migration would bypass their approvals.");
  if (positionHistory.length) blockers.push("Position assignments exist; a migration could rewrite approved job or organizational state.");
  if (payRevisions.length) blockers.push("Pay revisions exist; a migration cannot replace governed compensation history.");
  return blockers;
}
