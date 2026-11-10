import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDelegatedDecision } from '../scripts/qa/tenant-approval-delegated-proof.mjs';

test('delegated positive refuses role-only success and foreign identity despite HTTP 200', () => {
  const context = { task: { id: 31, approver: 'Fictional absent checker' },
    employer: { org: { id: 7 }, owner: { name: 'Fictional delegate' } }, status: 'Approved' };
  const json = { id: 31, organizationId: 7, decidedBy: 'Fictional delegate', status: 'Approved',
    webhookDeliveries: 0, decidedOnBehalfOf: 'Fictional absent checker', delegation: { roleMatched: false, delegated: true, permitted: true,
      originalApprover: 'Fictional absent checker', effectiveApprover: 'Fictional delegate' } };
  assert.doesNotThrow(() => assertDelegatedDecision({ status: 200, json }, context));
  for (const patch of [{ roleMatched: true }, { delegated: false }, { permitted: false },
    { originalApprover: 'Foreign checker' }, { effectiveApprover: 'Foreign delegate' }]) {
    assert.throws(() => assertDelegatedDecision({ status: 200, json: {
      ...json, delegation: { ...json.delegation, ...patch } } }, context));
  }
  assert.throws(() => assertDelegatedDecision({ status: 200, json: { ...json, organizationId: 99 } }, context),
    /accepts another employer's data/);
});
