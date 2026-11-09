/**
 * HCM lifecycle notification source-current recovery contract.
 * All database/HTTP proof is restricted to disposable fictional GitHub Actions PG16.
 */
import assert from "node:assert/strict";

export function requireDisposableLifecycleBoundary(env = process.env) {
  const fail = () => { throw new Error("HCM_LIFECYCLE_BOUNDARY_REFUSED: only disposable PG16 GitHub Actions targets"); };
  const valid = env.GITHUB_ACTIONS === "true" && env.CI === "true" &&
    env.NODE_ENV === "production" && env.DEMO_MODE === "false" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_HCM_LIFECYCLE_BOUNDARY_MODE === "fictional-pg16-http" &&
    env.TENANT_APPROVAL_TASK_MODE === "fictional-pg16-http" &&
    env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&
    ["WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
      "XENDIT_PAYOUTS_ENABLED", "XENDIT_BILLING_ENABLED"].every(key => env[key] === "false") &&
    ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
      "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
      "STRIPE_SECRET_KEY", "NEON_DATABASE_URL"].every(key => !env[key]);
  if (!valid) fail();
  return true;
}

export function requirePrivateNoLeak(response, { status, forbidden = [], label }) {
  assert.equal(response.status, status, label + ": " + String(response.text ?? "").slice(0, 180));
  const output = String(response.text ?? "") + "\n" +
    [...(response.headers ?? [])].map(([key, value]) => key + ":" + value).join("\n");
  if (status === 200 || status === 404 || status === 409 || status === 500)
    {
      const cache = response.headers.get("cache-control") ?? "";
      // "no-store" prevents both private and shared caching; middleware may
      // reorder the Cache-Control directives or omit redundant "private".
      assert.match(cache, /\bno-store\b/i,
        label + ": sensitive HCM task response must be no-store");
      assert.doesNotMatch(cache, /\bpublic\b/i,
        label + ": public caching is forbidden");
    }
  for (const marker of forbidden) {
    assert.ok(typeof marker === "string" && marker.length > 0, "forbidden marker required");
    assert.ok(!output.includes(marker), label + ": foreign/private marker leaked");
  }
  if (status !== 200) assert.ok(typeof response.json?.error === "string", label + ": denial needs JSON error");
  return response.json;
}

export function requireOneTaskTransition(before, after, id, action, actor) {
  const prior = before.tasks.find(row => row.id === id);
  const updated = after.tasks.find(row => row.id === id);
  assert.ok(prior && updated, "actual persisted source and updated tasks required");
  assert.equal(prior.organizationId, updated.organizationId);
  assert.notDeepEqual(updated, prior, "a successful write must change its own task");
  const eventDelta = after.events.filter(row => !before.events.some(old => old.id === row.id));
  const auditDelta = after.audits.filter(row => !before.audits.some(old => old.id === row.id));
  assert.equal(eventDelta.length, 1, "one real transactional event required");
  assert.equal(auditDelta.length, 1, "one real transactional audit required");
  assert.equal(eventDelta[0].taskId, id);
  assert.equal(eventDelta[0].organizationId, prior.organizationId);
  assert.equal(eventDelta[0].eventType, action);
  assert.equal(eventDelta[0].actorName, actor.name);
  assert.equal(auditDelta[0].organizationId, prior.organizationId);
  assert.equal(auditDelta[0].actor, actor.name);
  assert.equal(auditDelta[0].action, "HCM lifecycle notification " + action);
  assert.equal(auditDelta[0].metadata?.lifecycleTaskId, id);
  assert.deepEqual(after.employees, before.employees, "notification cannot change employee state");
  assert.deepEqual(after.payroll, before.payroll, "notification cannot change payroll");
  return { task: updated, event: eventDelta[0], audit: auditDelta[0] };
}
