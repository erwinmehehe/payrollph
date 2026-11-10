import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPayrollDecline } from '../scripts/qa/tenant-approval-payroll-decline-proof.mjs';

test('payroll rejection oracle refuses foreign run, tenant, actor and approval-looking HTTP 200', () => {
  const context = { task: { id: 31 }, run: { id: 11 },
    employer: { org: { id: 7 }, owner: { name: 'Fictional checker' } } };
  const json = { id: 31, payrollRunId: 11, organizationId: 7, decidedBy: 'Fictional checker',
    status: 'Declined', webhookDeliveries: 0, leaveUpdated: false };
  assert.doesNotThrow(() => assertPayrollDecline({ status: 200, json }, context));
  for (const patch of [{ id: 32 }, { payrollRunId: 12 }, { organizationId: 8 },
    { decidedBy: 'Foreign checker' }, { status: 'Approved' }, { leaveUpdated: true }]) {
    assert.throws(() => assertPayrollDecline({ status: 200, json: { ...json, ...patch } }, context));
  }
});
