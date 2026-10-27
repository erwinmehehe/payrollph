import { eq } from 'drizzle-orm';

// Snapshot the source records behind the recovered reads, not only organizations
// and audit metadata. The SQL-only work-item event table is prepared before seeding.
export async function readRecoverySnapshot(db, pool, orgId) {
  const schema = await import('../../src/db/schema.ts');
  const names = ['leaveRequests', 'approvalTasks', 'hcmBusinessProcessInstances',
    'jobProfiles', 'positions', 'positionAssignments', 'worksites', 'shiftDefinitions',
    'staffingRequirements', 'workforceDemandImportBatches', 'workforceDemandObservationRevisions',
    'employeeScheduleAssignments', 'automationOperationalCases', 'employeePayProfiles', 'payrollRuns'];
  const out = {};
  for (const name of names) {
    const table = schema[name];
    if (!table?.organizationId || !table.id) throw new Error('Recovery snapshot source missing: ' + name);
    out[name] = await db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(table.id);
  }
  out.workItemEvents = (await pool.query('SELECT * FROM hcm_work_item_events WHERE organization_id=$1 ORDER BY id', [orgId])).rows;
  return out;
}
