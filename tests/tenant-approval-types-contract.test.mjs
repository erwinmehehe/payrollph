import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OFF_FLAGS, requireApprovalTypesTarget, assertTypedDecision } from '../scripts/qa/tenant-approval-types-contract.mjs';

const safe = { TENANT_APPROVAL_TYPES_MODE: 'fictional-disposable-pg16', NODE_ENV: 'production',
  DEMO_MODE: 'false', DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:55436/app_db',
  SECURITY_SMOKE_URL: 'http://127.0.0.1:3310', ...Object.fromEntries(OFF_FLAGS.map(key => [key, 'false'])) };
test('typed approval proof refuses existing dev ports, remote databases and provider flags before imports', () => {
  assert.doesNotThrow(() => requireApprovalTypesTarget(safe));
  assert.doesNotThrow(() => requireApprovalTypesTarget({ ...safe, CI: 'true', GITHUB_ACTIONS: 'true',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db', SECURITY_SMOKE_URL: 'http://127.0.0.1:3000' }));
  for (const patch of [{ DATABASE_URL: 'postgresql://postgres:postgres@db.example.invalid/app_db' },
    { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db' },
    { SECURITY_SMOKE_URL: 'https://payroll.example.invalid' }, { DEMO_MODE: 'true' },
    { GITHUB_ACTIONS: 'true' }, { NODE_ENV: 'development' }, { RESEND_API_KEY: 'fake-but-refused' },
    ...OFF_FLAGS.map(flag => ({ [flag]: 'true' }))]) assert.throws(() => requireApprovalTypesTarget({ ...safe, ...patch }));
});
test('own decision discriminator rejects another employer even when HTTP is 200', () => {
  const input = { task: { id: 17 }, employer: { org: { id: 7 }, owner: { name: 'Fictional owner' } }, status: 'Approved' };
  const response = { status: 200, json: { id: 17, organizationId: 7, decidedBy: 'Fictional owner', status: 'Approved', webhookDeliveries: 0 } };
  assert.doesNotThrow(() => assertTypedDecision(response, input));
  for (const changed of [{ id: 27 }, { organizationId: 19 }]) {
    assert.throws(() => assertTypedDecision({ ...response, json: { ...response.json, ...changed } }, input), /accepts another employer's data/);
  }
});
test('real-HTTP fixture retains source writes, high-ID victim controls and database audit veto', () => {
  const source = readFileSync('scripts/qa/tenant-approval-types-http.mjs', 'utf8');
  assert.ok(source.indexOf('requireApprovalTypesTarget();') < source.indexOf('import(\'../../src/db/index.ts\')'));
  for (const marker of ['for (const e of [a, b])', 'hcm.startHcmBusinessProcessTx',
    'automationEngine.advanceAutomationExecution', 'sourceKey: String(v.scenario.id)',
    'forged foreign ', 'QA_TYPED_APPROVAL_AUDIT_VETO', 'await unchanged(victim,',
    'assert.equal(ownWrites, 19)', 'assert.equal(victimDenials, 18)',
    'assert.equal(sourceGuardDenials, 20)', 'assert.equal(auditRollbacks, 18)', 'assert.equal(discriminations, 9)',
    'coverageCredits: 0', 'providerCalled: false']) assert.ok(source.includes(marker), marker);
  const route = readFileSync('src/app/api/approvals/[id]/route.ts', 'utf8');
  const boundary = route.indexOf('await approvalSourceTenantBoundary(tx, taskId, task.organizationId)');
  assert.ok(boundary > route.indexOf('db.transaction(async (tx)'));
  assert.ok(boundary < route.indexOf('await tx.update(approvalTasks)'));
  const workflow = readFileSync('.github/workflows/tenant-approval-types-http.yml', 'utf8');
  for (const flag of OFF_FLAGS) assert.ok(workflow.includes(flag));
  assert.ok(workflow.includes('image: postgres:16'));
  assert.ok(workflow.includes('ref: ${{ github.event.pull_request.head.sha }}'));
});
