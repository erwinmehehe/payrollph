import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableResendWebhook,
  RESEND_WEBHOOK_METHODS,
} from "../scripts/qa/tenant-webhook-resend-contract.mjs";
import {
  assertFictionalHighIdVictim, assertEmployerSnapshotIsolation, assertExpectedOwnedDelivery,
} from "../scripts/qa/tenant-webhook-resend-http.mjs";

const good = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_WEBHOOK_RESEND_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  RESEND_WEBHOOK_SECRET: "whsec_" + "A".repeat(43) + "=",
});

test("Resend delivery callback tenant proof refuses remote data or any provider credential", () => {
  assert.doesNotThrow(() => requireDisposableResendWebhook(good()));
  const refuse = patch => assert.throws(() => requireDisposableResendWebhook({ ...good(), ...patch }),
    /RESEND_WEBHOOK_REFUSED/);
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@live.invalid:5432/app_db" });
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" });
  refuse({ SECURITY_SMOKE_URL: "https://example.invalid" });
  refuse({ GITHUB_ACTIONS: "false" });
  refuse({ XENDIT_BILLING_ENABLED: "true" });
  refuse({ XENDIT_PAYOUTS_ENABLED: "true" });
  refuse({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refuse({ RESEND_API_KEY: "re_production_never" });
  refuse({ POSTMARK_SERVER_TOKEN: "postmark_never" });
  refuse({ SMTP_URL: "smtp://mail.invalid" });
  refuse({ RESEND_WEBHOOK_SECRET: "whsec_short" });
  refuse({ RESEND_WEBHOOK_SECRET: "not-a-signing-secret" });
  refuse({ RESEND_WEBHOOK_SECRET: undefined });
});

test("proof is inbound-only, one callback route, zero manifest credits", () => {
  assert.deepEqual(RESEND_WEBHOOK_METHODS, ["src/app/api/webhooks/resend/route.ts POST"]);
  const harness = readFileSync("scripts/qa/tenant-webhook-resend-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-webhook-resend-http.yml", "utf8");
  assert.ok(harness.indexOf("requireDisposableResendWebhook();")
    < harness.indexOf('import("../../src/db/index.ts")'), "refusal must run before DB import");
  for (const term of [
    "a real foreign row must not be distinguishable from a nonexistent row",
    "other employer outbox and audit rows unchanged",
    "concurrent duplicates must not double-write",
    "a signed event must not plant a provider message id on an unsent row",
    "an old replay must not rewrite delivery state",
    "old replay after 520 unrelated receipts",
    "a callback never creates or removes outbox rows",
    "A rejected receipt insert must fail the complete callback so the provider retries",
    "rolled-back callback recovers on retry",
    "for (let i = 0; i < 6; i++)",
    "const employers = [a, b, ...fillers, victim]",
    "assertFictionalHighIdVictim(a, b, victim, fillers)",
    "assertEmployerSnapshotIsolation(before, after, allowed)",
    "signed unknown event type",
    "signed event for another app",
    "signed event without tags",
    "signature over another payload",
    "a Resend event for a row sent by another provider",
    "system row replay is applied again",
    "productionTested: false",
    "methodCoverageCredit: false",
  ]) {
    assert.ok(harness.includes(term), "missing proof intent: " + term);
  }
  assert.ok(workflow.includes('PAYMONGO_DISBURSEMENTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_PAYOUTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_BILLING_ENABLED: "false"'), "no billing in this job");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-resend-http.mjs"));
  assert.ok(workflow.includes("resend-webhook-isolation:"), "job name identifies this proof");
  assert.ok(workflow.includes("RESEND_WEBHOOK_SECRET=$secret"), "the signing secret is generated per run");
  assert.ok(workflow.includes('echo "RESEND_API_KEY="'), "the job must blank the provider API key");
  assert.ok(!/RESEND_API_KEY=[^\s"]/.test(workflow), "the job must never carry a provider API key");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/webhooks/resend/route.ts"];
  assert.ok(entry, "webhook method still inventoried");
  const method = entry.methods.find(m => m.name === "POST");
  // Status-agnostic on purpose: only a separate reviewed credit PR may move the method, and when it does
  // it must link this exact proof rather than leave a bare COVERED.
  assert.ok(["GAP", "COVERED"].includes(method?.status));
  if (method.status === "GAP") assert.equal(method.testedBy, null, "A source-only proof candidate cannot self-credit the method");
  else assert.equal(method.testedBy?.file, "scripts/qa/tenant-webhook-resend-http.mjs");
});

function fixtureEmployer(id) {
  return Object.fromEntries(["org", "entity", "unit", "owner", "worker"].map(field => [field, { id }]));
}

test("PG16 victim discriminator refuses IDs under seven or not higher than both attackers", () => {
  const withMail = (id, mail) => ({ ...fixtureEmployer(id), mail: { sent: { id: mail } } });
  const a = withMail(1, 1);
  const b = withMail(2, 2);
  const victim = withMail(9, 9);
  const fillers = Array.from({ length: 6 }, (_, i) => withMail(i + 3, i + 3));
  assert.doesNotThrow(() => assertFictionalHighIdVictim(a, b, victim, fillers));
  for (const field of ["org", "entity", "unit", "owner", "worker"]) {
    const raised = structuredClone(fillers);
    raised[5][field].id = 10;
    assert.throws(() => assertFictionalHighIdVictim(a, b, victim, raised),
      /Higher-ID real victim/, "victim must be above every filler " + field + " ID");
    for (const bad of [1, 2, 6, 7.25]) {
      const mutated = structuredClone(victim);
      mutated[field].id = bad;
      assert.throws(() => assertFictionalHighIdVictim(a, b, mutated),
        /Higher-ID real victim/, field + " must be a higher, persisted integer");
    }
  }
  const raisedMail = structuredClone(fillers);
  raisedMail[5].mail.sent.id = 10;
  assert.throws(() => assertFictionalHighIdVictim(a, b, victim, raisedMail), /Higher-ID real victim outbox/);
  for (const bad of [2, 6, null, 6.5]) {
    const mutated = structuredClone(victim);
    mutated.mail.sent.id = bad;
    assert.throws(() => assertFictionalHighIdVictim(a, b, mutated), /Higher-ID real victim outbox/);
  }
});

const COHORT = ["ATTA", "ATTB", "FILL0", "FILL1", "FILL2", "FILL3", "FILL4", "FILL5", "VICTIM"];
const cohort = () => Object.fromEntries(COHORT.map(label => [label, {
  outbox: [{ id: 1, organizationId: 1, providerMessageId: "m_" + label, deliveryStatus: "accepted", deliveryDetail: null, deliveryUpdatedAt: null }],
  auditEvents: [], employees: [{ marker: label }],
}]));

test("snapshot guard preserves all nine employers and detects a forged victim write", () => {
  const before = cohort();
  assert.doesNotThrow(() => assertEmployerSnapshotIsolation(before, structuredClone(before)));
  const own = structuredClone(before);
  own.ATTA.outbox[0].deliveryStatus = "delivered";
  assert.doesNotThrow(() => assertEmployerSnapshotIsolation(before, own, ["ATTA"]));
  assert.throws(() => assertEmployerSnapshotIsolation(before, own),
    /other employer outbox and audit rows unchanged/, "a delivery write needs explicit own-scope allowance");
  const ownEmployees = structuredClone(own);
  ownEmployees.ATTA.employees[0].marker = "unexpected worker write";
  assert.throws(() => assertEmployerSnapshotIsolation(before, ownEmployees, ["ATTA"]),
    /only outbox and audit rows may change/, "even an authorized callback cannot change its own employees");
  const victimMutated = structuredClone(own);
  victimMutated.VICTIM.outbox[0].providerMessageId = "planted";
  assert.throws(() => assertEmployerSnapshotIsolation(before, victimMutated, ["ATTA"]),
    /other employer outbox and audit rows unchanged/, "a planted message id cannot reach the victim");
  const fillerMutated = structuredClone(own);
  fillerMutated.FILL5.auditEvents.push({ actor: "forged" });
  assert.throws(() => assertEmployerSnapshotIsolation(before, fillerMutated, ["ATTA"]),
    /other employer outbox and audit rows unchanged/, "filler employers are not ignored");
  const omitted = structuredClone(own);
  delete omitted.FILL2;
  assert.throws(() => assertEmployerSnapshotIsolation(before, omitted, ["ATTA"]), /All seeded employers/);
  const incompleteBefore = structuredClone(before);
  delete incompleteBefore.FILL2;
  assert.throws(() => assertEmployerSnapshotIsolation(incompleteBefore, omitted, ["ATTA"]), /All seeded employers/,
    "missing employer in both snapshots must fail closed");
  assert.throws(() => assertEmployerSnapshotIsolation(before, own, ["GHOST"]), /Only seeded employers/);
});

test("owned delivery is bounded to the named row, its three state columns and one exact receipt", () => {
  const base = {
    outbox: [
      { id: 1, organizationId: 1, provider: "resend", purpose: "payslip-ready", providerMessageId: "m1", deliveryStatus: "accepted", deliveryDetail: null, deliveryUpdatedAt: null },
      { id: 2, organizationId: 1, provider: "resend", purpose: "payslip-ready", providerMessageId: "m2", deliveryStatus: "accepted", deliveryDetail: null, deliveryUpdatedAt: null },
    ],
    auditEvents: [{ id: 5, organizationId: 1, action: "old", actor: "original" }],
    employees: [{ id: 6, organizationId: 1, marker: "private" }],
  };
  const before = { ATTA: structuredClone(base) };
  const after = structuredClone(before);
  after.ATTA.outbox[0].deliveryStatus = "delivered";
  after.ATTA.outbox[0].deliveryUpdatedAt = "2026-11-04T10:00:00.000Z";
  after.ATTA.auditEvents.push({
    id: 7, organizationId: 1, action: "Email provider delivery event", actor: "system:resend-webhook", resource: "outbox #1",
    metadata: { outboxId: 1, purpose: "payslip-ready", eventId: "evt_1", provider: "resend", providerMessageId: "m1", eventType: "email.delivered", occurredAt: "2026-11-04T10:00:00.000Z", deliveryStatus: "delivered", detail: null },
  });
  const expectation = { outboxId: 1, deliveryStatus: "delivered", eventType: "email.delivered", occurredAt: "2026-11-04T10:00:00.000Z", eventId: "evt_1", providerMessageId: "m1", receipts: 1 };
  assert.doesNotThrow(() => assertExpectedOwnedDelivery(before, after, "ATTA", expectation));
  const mutate = fn => {
    const changed = structuredClone(after);
    fn(changed.ATTA);
    assert.throws(() => assertExpectedOwnedDelivery(before, changed, "ATTA", expectation));
  };
  mutate(owner => { owner.employees[0].marker = "cross-feature-corruption"; });
  mutate(owner => { owner.outbox[0].providerMessageId = "planted"; });
  mutate(owner => { owner.outbox[0].deliveryUpdatedAt = null; });
  mutate(owner => { owner.outbox[0].deliveryUpdatedAt = "2026-11-04T10:00:01.000Z"; });
  mutate(owner => { owner.outbox[0].provider = "postmark"; });
  mutate(owner => { owner.outbox[1].deliveryStatus = "delivered"; });
  mutate(owner => { owner.outbox.push({ id: 3, organizationId: 1 }); });
  mutate(owner => { owner.auditEvents.push({ id: 8, organizationId: 1, action: "Email provider delivery event", actor: "system:resend-webhook", resource: "outbox #1", metadata: {} }); });
  mutate(owner => { owner.auditEvents[0].actor = "rewritten"; });
  mutate(owner => { owner.auditEvents[1].organizationId = 999; });
  mutate(owner => { owner.auditEvents[1].resource = "outbox #2"; });
  mutate(owner => { owner.auditEvents[1].metadata.eventId = "other"; });
  mutate(owner => { owner.auditEvents[1].metadata.outboxId = 2; });
  mutate(owner => { owner.auditEvents[1].metadata.purpose = "unrelated"; });
  mutate(owner => { owner.auditEvents[1].metadata.eventType = "email.failed"; });
  mutate(owner => { owner.auditEvents[1].metadata.occurredAt = "2026-11-03T10:00:00.000Z"; });
  mutate(owner => { owner.auditEvents[1].metadata.detail = "wrong"; });
  mutate(owner => { owner.auditEvents[1].actor = "someone"; });
});
