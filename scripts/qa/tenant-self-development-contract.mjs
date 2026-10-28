import assert from 'node:assert/strict';

export const ENDPOINT = '/api/self/performance/development-plans';
export const METHODS = Object.freeze(['GET self/performance/development-plans', 'POST self/performance/development-plans', 'PATCH self/performance/development-plans']);
export const plain = value => JSON.parse(JSON.stringify(value));
export function requireDisposable(env = process.env) {
  let app, db;
  try { app = new URL(env.SECURITY_SMOKE_URL); db = new URL(env.DATABASE_URL); } catch { throw Error('SELF_DEVELOPMENT_REFUSED: explicit localhost URLs required'); }
  assert.ok(env.TENANT_SELF_DEVELOPMENT_MODE === 'fictional-disposable-only' &&
    app.href === 'http://127.0.0.1:3000/' && !db.search && !db.hash && db.protocol === 'postgresql:' && db.hostname === '127.0.0.1' &&
    db.port === '5432' && db.pathname === '/app_db' && db.username === 'postgres' &&
    env.NODE_ENV === 'production' && env.WORKER_ENABLED === 'false' && env.CENTRAL_SCHEDULER_ENABLED === 'false' &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === 'false' && env.XENDIT_PAYOUTS_ENABLED === 'false' && env.XENDIT_BILLING_ENABLED === 'false' &&
    !['PAYMONGO_SECRET_KEY','XENDIT_SECRET_KEY','XENDIT_PAYOUT_SECRET_KEY','RESEND_API_KEY','POSTMARK_SERVER_TOKEN','SMTP_URL'].some(key => env[key]),
  'SELF_DEVELOPMENT_REFUSED: disposable localhost only; workers, providers and money disabled');
}
export function proveRead(response, before, actor) {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.json), ['plans']);
  const expected = before.plans.filter(row => row.employeeId === actor.worker.id && row.employeeVisible)
    .sort((a,b) => a.targetDate.localeCompare(b.targetDate)).map(plan => ({ ...plan,
      skill: before.skills.find(skill => skill.id === plan.skillId),
      milestones: before.milestones.filter(row => row.planId === plan.id).sort((a,b) => a.dueDate.localeCompare(b.dueDate)),
      progress: before.progress.filter(row => row.planId === plan.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  assert.ok(expected.length >= 3, 'nonempty open/completed/cancelled fixture required');
  for (const row of expected) { assert.equal(row.organizationId, actor.org.id); assert.ok(row.title.includes(actor.marker)); }
  assert.deepEqual(response.json.plans, expected, 'exact own worker plans and linked evidence only');
}
function unchanged(before, after, allowed) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const key of Object.keys(before)) if (!allowed.includes(key)) assert.deepEqual(after[key], before[key], key + ' cannot change');
}
function audit(before, after, actor, action, resource, metadata) {
  assert.equal(after.audits.length, before.audits.length + 1);
  const added = after.audits.filter(row => !before.audits.some(old => old.id === row.id)); assert.equal(added.length, 1);
  assert.deepEqual(after.audits.filter(row => row.id !== added[0].id), before.audits);
  assert.equal(added[0].organizationId, actor.org.id); assert.equal(added[0].actor, actor.ess.name);
  assert.equal(added[0].action, action); assert.equal(added[0].resource, resource); assert.deepEqual(added[0].metadata, metadata);
}
export function proveProgress(before, after, actor, response, content, percent) {
  unchanged(before, after, ['progress','audits']); assert.equal(response.status, 201);
  assert.equal(after.progress.length, before.progress.length + 1);
  const added = after.progress.filter(row => !before.progress.some(old => old.id === row.id)); assert.equal(added.length, 1);
  const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
  assert.equal(row.organizationId, actor.org.id); assert.equal(row.employeeId, actor.worker.id);
  assert.equal(row.planId, actor.open.id); assert.equal(row.authorUserId, actor.ess.id);
  assert.equal(row.authorEmployeeId, actor.worker.id); assert.equal(row.authorName, actor.ess.name);
  assert.equal(row.content, content); assert.equal(row.progressPercent, percent); assert.ok(Number.isFinite(Date.parse(row.createdAt)));
  assert.deepEqual(response.json, row); assert.deepEqual(after.progress.filter(item => item.id !== row.id), before.progress);
  audit(before, after, actor, 'Employee added skill development progress', actor.open.title,
    { developmentPlanId: actor.open.id, progressUpdateId: row.id, progressPercent: percent });
}
export function proveMilestone(before, after, actor, response, status) {
  unchanged(before, after, ['milestones','audits']); assert.equal(response.status, 200);
  assert.equal(after.milestones.length, before.milestones.length);
  const old = before.milestones.find(row => row.id === actor.milestone.id), row = after.milestones.find(item => item.id === actor.milestone.id);
  assert.ok(old && row); assert.equal(row.organizationId, actor.org.id); assert.equal(row.planId, actor.open.id);
  assert.equal(row.status, status); assert.notEqual(row.status, old.status);
  assert.ok(Number.isFinite(Date.parse(row.updatedAt)));
  if (status === 'completed') {
    assert.ok(Number.isFinite(Date.parse(row.completedAt))); assert.equal(row.completedByUserId, actor.ess.id); assert.equal(row.completedByName, actor.ess.name);
  } else { assert.equal(row.completedAt, null); assert.equal(row.completedByUserId, null); assert.equal(row.completedByName, null); }
  const stable = ({ status: _s, updatedAt: _u, completedAt: _c, completedByUserId: _id, completedByName: _name, ...rest }) => rest;
  assert.deepEqual(stable(row), stable(old)); assert.deepEqual(response.json, row);
  assert.deepEqual(after.milestones.filter(item => item.id !== row.id), before.milestones.filter(item => item.id !== row.id));
  audit(before, after, actor, status === 'completed' ? 'Employee completed development milestone' : 'Employee progressed development milestone', row.title,
    { developmentPlanId: actor.open.id, milestoneId: row.id, status });
}
