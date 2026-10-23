import test from 'node:test';
import assert from 'node:assert/strict';
import { underpaymentDuplicateConflict } from '../src/lib/underpayment-duplicate';

test('duplicate conflict preserves default-off parity and only translates the exact source constraint', () => {
  const unique = { code: '23505', constraint: 'payroll_underpayment_one_source_unique' };
  assert.equal(underpaymentDuplicateConflict(unique, {}), false);
  assert.equal(underpaymentDuplicateConflict(unique, { UNDERPAYMENT_DUPLICATE_CONFLICT_ENABLED: 'TRUE' }), false);
  const on = { UNDERPAYMENT_DUPLICATE_CONFLICT_ENABLED: 'true' };
  assert.equal(underpaymentDuplicateConflict(unique, on), true);
  assert.equal(underpaymentDuplicateConflict({ cause: unique }, on), true);
  assert.equal(underpaymentDuplicateConflict({ ...unique, constraint: 'unrelated_unique' }, on), false);
  assert.equal(underpaymentDuplicateConflict({ ...unique, code: '23514' }, on), false);
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(underpaymentDuplicateConflict(cyclic, on), false);
  assert.equal(underpaymentDuplicateConflict(null, on), false);
});
