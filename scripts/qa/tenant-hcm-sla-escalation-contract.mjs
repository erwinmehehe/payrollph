import assert from "node:assert/strict";

/** Reject anything except a one-off fictional CI database and loopback server. */
export function requireDisposableHcmSla(env = process.env) {
  const refuse = reason => { throw new Error("HCM_SLA_QA_REFUSED: " + reason); };
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL || "");
    database = new URL(env.DATABASE_URL || "");
  } catch { refuse("explicit URLs required"); }
  const checks = [
    [env.CI === "true" && env.GITHUB_ACTIONS === "true", "GitHub CI only"],
    [env.TENANT_SECOND_PASS_MODE === "isolated-ci-only", "disposable proof mode"],
    [env.TENANT_HCM_SLA_QA_MODE === "fictional-disposable-only", "explicit opt in"],
    [env.NODE_ENV === undefined, "runner must unset NODE_ENV"],
    [app.href === "http://127.0.0.1:3000/", "localhost-only HTTP"],
    [database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db", "local PG16 app_db"],
    [env.DEMO_MODE === "false", "demo mode forbidden"],
    [env.WORKER_ENABLED === "false" && env.CENTRAL_SCHEDULER_ENABLED === "false",
      "no workers or scheduler"],
    [env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
      env.XENDIT_PAYOUTS_ENABLED === "false" &&
      env.XENDIT_BILLING_ENABLED === "false", "no payment providers"],
    [/^[0-9a-f]{64}$/.test(env.HCM_SLA_CRON_SECRET || ""), "ephemeral fictional cron token required"],
  ];
  for (const [ok, reason] of checks) if (!ok) refuse(reason);
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_API_KEY",
    "RESEND_API_KEY", "SMTP_URL", "NEON_DATABASE_URL", "DATABASE_URL_UNPOOLED",
  ]) if (env[name]) refuse(name + " must be absent");
}

export function assertDenied(response, expected, forbidden = []) {
  assert.equal(response.status, expected, "unauthorized sweep response");
  const raw = response.text + "\n" + [...(response.headers?.entries?.() || [])]
    .map(([k, v]) => k + ":" + v).join("\n");
  for (const marker of forbidden) {
    assert.ok(!raw.includes(marker), "refusal leaks fictional employer marker");
  }
}

export function assertSweepResponse(response, count, forbidden = []) {
  assert.equal(response.status, 200, "scheduled sweep must complete");
  assert.deepEqual(response.json, { escalated: count, remainingMayExist: false });
  for (const marker of forbidden) assert.ok(!response.text.includes(marker), "sweep leaks employer");
}

function sameUnrelated(before, after) {
  for (const name of ["employees", "payProfiles", "payrollRuns", "audits"]) {
    assert.deepEqual(after[name], before[name], name + " must never change");
  }
}

export function assertTenantEscalation(before, after, expected) {
  const { caseId, organizationId, recipient, ownerId, foreignMarkers = [] } = expected;
  sameUnrelated(before, after);
  assert.equal(after.cases.length, before.cases.length, "no cases created or removed");
  const prior = before.cases.find(x => x.id === caseId);
  const later = after.cases.find(x => x.id === caseId);
  assert.ok(prior && later, "genuine persisted due case required");
  assert.equal(prior.organization_id, organizationId);
  assert.equal(prior.escalated_at, null, "case was not already escalated");
  assert.equal(later.escalation_level, 1);
  assert.ok(Number.isFinite(Date.parse(later.escalated_at)), "real escalation timestamp required");
  assert.deepEqual(later, {
    ...prior,
    escalated_at: later.escalated_at,
    escalation_level: 1,
    updated_at: later.updated_at,
  }, "only escalation fields may change");
  assert.deepEqual(after.cases.filter(x => x.id !== caseId),
    before.cases.filter(x => x.id !== caseId), "unrelated work items unchanged");
  const events = after.events.filter(x => !before.events.some(old => old.id === x.id));
  assert.equal(events.length, 1, "exactly one durable escalation event");
  assert.equal(events[0].organization_id, organizationId);
  assert.equal(events[0].case_id, caseId);
  assert.equal(events[0].event_type, "sla_escalated");
  assert.equal(events[0].next_value.level, 1);
  assert.equal(events[0].next_value.team, "HR Operations");
  assert.equal(events[0].next_value.ownerUserId, ownerId);
  assert.deepEqual(after.events.filter(x => x.id !== events[0].id), before.events);
  const messages = after.outbox.filter(x => !before.outbox.some(old => old.id === x.id));
  assert.equal(messages.length, 1, "one queued notification for authorized owner only");
  const message = messages[0];
  assert.equal(message.organization_id, organizationId);
  assert.equal(message.recipient, recipient);
  assert.equal(message.purpose, "hcm_sla_escalation");
  assert.equal(message.channel, "email");
  assert.equal(message.status, "queued");
  assert.ok(message.dedupe_key.startsWith("hcm-sla:" + organizationId + ":" + caseId + ":"));
  for (const marker of foreignMarkers) {
    assert.ok(!JSON.stringify(events).includes(marker), "foreign marker in event");
    assert.ok(!JSON.stringify(messages).includes(marker), "foreign marker in notification");
  }
  assert.deepEqual(after.outbox.filter(x => x.id !== message.id), before.outbox);
}

export function assertUnchanged(before, after) {
  assert.deepEqual(after, before, "unauthorized, repeat or ineligible sweep modified tenant data");
}
