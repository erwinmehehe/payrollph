import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposableXenditSubscriptionsWebhook,
  XENDIT_SUBSCRIPTIONS_WEBHOOK_METHODS,
} from "../scripts/qa/tenant-webhook-xendit-subscriptions-contract.mjs";
import {
  assertFictionalHighIdVictim, assertEmployerSnapshotIsolation,
} from "../scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs";

const good = () => ({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", TENANT_WEBHOOK_XENDIT_SUBSCRIPTIONS_MODE: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "true",
  XENDIT_CALLBACK_TOKEN: "a".repeat(64),
  XENDIT_BUSINESS_ID: "biz-synthetic-" + "b".repeat(16),
});

test("Xendit subscription callback tenant proof refuses remote data or provider activation", () => {
  assert.doesNotThrow(() => requireDisposableXenditSubscriptionsWebhook(good()));
  const refuse = patch => assert.throws(() => requireDisposableXenditSubscriptionsWebhook({ ...good(), ...patch }),
    /XENDIT_SUBSCRIPTIONS_WEBHOOK_REFUSED/);
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@live.invalid:5432/app_db" });
  refuse({ DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" });
  refuse({ SECURITY_SMOKE_URL: "https://example.invalid" });
  refuse({ GITHUB_ACTIONS: "false" });
  refuse({ XENDIT_BILLING_ENABLED: "false" });
  refuse({ XENDIT_PAYOUTS_ENABLED: "true" });
  refuse({ PAYMONGO_DISBURSEMENTS_ENABLED: "true" });
  refuse({ XENDIT_SECRET_KEY: "xnd_production_never" });
  refuse({ XENDIT_CALLBACK_TOKEN: "short" });
  refuse({ XENDIT_BUSINESS_ID: "real-merchant" });
});

test("proof is inbound-only, one callback route, zero manifest credits", () => {
  assert.deepEqual(XENDIT_SUBSCRIPTIONS_WEBHOOK_METHODS,
    ["src/app/api/webhooks/xendit/subscriptions/route.ts POST"]);
  const harness = readFileSync("scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-webhook-xendit-subscriptions-http.yml", "utf8");
  assert.ok(harness.indexOf("requireDisposableXenditSubscriptionsWebhook();")
    < harness.indexOf('import("../../src/db/index.ts")'), "refusal must run before DB import");
  for (const term of [
    "a real foreign pair must not be distinguishable from a nonexistent pair",
    "other employer billing and audit rows unchanged",
    "concurrent duplicates must not double-write",
    "forged selectors ignored",
    "stale plan ignored",
    "for (let i = 0; i < 6; i++)",
    "const employers = [a, b, ...fillers, victim]",
    "assertFictionalHighIdVictim(a, b, victim)",
    "assertEmployerSnapshotIsolation(before, after, allowed)",
    "signed callback missing reference",
    "signed callback missing provider plan",
    "forged victim-selector replay",
    "B's own successful callback requires its own audit receipt",
    "A legitimate victim provider event must audit only that victim",
    "productionTested: false",
    "methodCoverageCredit: false",
  ]) {
    assert.ok(harness.includes(term), "missing proof intent: " + term);
  }
  assert.ok(workflow.includes('PAYMONGO_DISBURSEMENTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_PAYOUTS_ENABLED: "false"'));
  assert.ok(workflow.includes('XENDIT_BILLING_ENABLED: "true"'), "billing is enabled only inside this disposable job");
  assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs"));
  assert.ok(workflow.includes("xendit-subscriptions-webhook-isolation:"), "job name identifies this proof");
  assert.ok(!/XENDIT_SECRET_KEY=[^\s"]/.test(workflow), "the job must never carry a provider secret key");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.allApiRouteFiles["src/app/api/webhooks/xendit/subscriptions/route.ts"];
  assert.ok(entry, "webhook method still inventoried");
  const method = entry.methods.find(m => m.name === "POST");
  assert.equal(method?.status, "GAP", "Only a separate reviewed promotion may change the method from GAP");
  assert.equal(method?.testedBy, null, "A source-only proof candidate cannot self-credit the method");
});

function fixtureEmployer(id) {
  return Object.fromEntries(["org", "entity", "unit", "owner", "worker"]
    .map(field => [field, { id }]));
}

test("PG16 victim discriminator refuses IDs under seven or not higher than both attackers", () => {
  const a = { ...fixtureEmployer(1), billing: { subscription: { id: 1 }, checkout: { id: 1 } } };
  const b = { ...fixtureEmployer(2), billing: { subscription: { id: 2 }, checkout: { id: 2 } } };
  const victim = { ...fixtureEmployer(9), billing: { subscription: { id: 9 }, checkout: { id: 9 } } };
  const fillers = Array.from({ length: 6 }, (_, i) => ({
    ...fixtureEmployer(i + 3),
    billing: { subscription: { id: i + 3 }, checkout: { id: i + 3 } },
  }));
  assert.doesNotThrow(() => assertFictionalHighIdVictim(a, b, victim, fillers));
  for (const field of ["org", "entity", "unit", "owner", "worker"]) {
    const raised = structuredClone(fillers);
    raised[5][field].id = 10;
    assert.throws(() => assertFictionalHighIdVictim(a, b, victim, raised),
      /Higher-ID real victim/, "victim must be above every filler " + field + " ID");
  }
  for (const field of ["subscription", "checkout"]) {
    const raised = structuredClone(fillers);
    raised[5].billing[field].id = 10;
    assert.throws(() => assertFictionalHighIdVictim(a, b, victim, raised),
      /Higher-ID real victim/, "victim must be above every filler billing " + field + " ID");
  }
  for (const field of ["org", "entity", "unit", "owner", "worker"]) {
    for (const bad of [1, 2, 6, 7.25]) {
      const mutated = structuredClone(victim);
      mutated[field].id = bad;
      assert.throws(() => assertFictionalHighIdVictim(a, b, mutated),
        /Higher-ID real victim/, field + " must be a higher, persisted integer");
    }
  }
  for (const field of ["subscription", "checkout"]) {
    for (const bad of [2, 6, null, 6.5]) {
      const mutated = structuredClone(victim);
      mutated.billing[field].id = bad;
      assert.throws(() => assertFictionalHighIdVictim(a, b, mutated),
        /Higher-ID real victim/, field + " must not borrow a fake, low or attacker-owned ID");
    }
  }
});

test("snapshot guard preserves all nine employers and detects a forged victim write", () => {
  const before = Object.fromEntries(
    ["ATTA", "ATTB", "FILL0", "FILL1", "FILL2", "FILL3", "FILL4", "FILL5", "VICTIM"]
      .map(label => [label, {
        subscriptions: [{ id: 1, status: label }],
        invoices: [], auditEvents: [], billingEvents: [], employees: [{ marker: label }],
      }])
  );
  assert.doesNotThrow(() => assertEmployerSnapshotIsolation(before, structuredClone(before)));
  const own = structuredClone(before);
  own.ATTA.invoices.push({ id: 1, organizationId: 1 });
  assert.doesNotThrow(() => assertEmployerSnapshotIsolation(before, own, ["ATTA"]));
  assert.throws(() => assertEmployerSnapshotIsolation(before, own),
    /other employer billing and audit rows unchanged/, "a business write needs explicit own-scope allowance");
  const victimMutated = structuredClone(own);
  victimMutated.VICTIM.auditEvents.push({ actor: "forged" });
  assert.throws(() => assertEmployerSnapshotIsolation(before, victimMutated, ["ATTA"]),
    /other employer billing and audit rows unchanged/, "forged selectors cannot mutate victim audit");
  const fillerMutated = structuredClone(own);
  fillerMutated.FILL5.employees[0].marker = "stolen";
  assert.throws(() => assertEmployerSnapshotIsolation(before, fillerMutated, ["ATTA"]),
    /other employer billing and audit rows unchanged/, "filler employers are not ignored");
  const omitted = structuredClone(own);
  delete omitted.FILL2;
  assert.throws(() => assertEmployerSnapshotIsolation(before, omitted, ["ATTA"]),
    /All seeded employers/, "missing employer snapshot must fail closed");
  // A symmetric omission previously passed because only the key sets were compared.
  const incompleteBefore = structuredClone(before);
  delete incompleteBefore.FILL2;
  assert.throws(() => assertEmployerSnapshotIsolation(incompleteBefore, omitted, ["ATTA"]),
    /All seeded employers/, "missing employer in both snapshots must fail closed");
  assert.throws(() => assertEmployerSnapshotIsolation(before, own, ["GHOST"]),
    /Only seeded employers/, "unknown allowed employer must not bypass the immutability guard");
});
