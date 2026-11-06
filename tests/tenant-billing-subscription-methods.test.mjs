import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  requireFictionalProviderEnv, FIXTURE_KEY, simulatedXenditFetch,
} from "../scripts/qa/tenant-billing-subscription-provider-preload.mjs";

const START = "src/app/api/billing/subscription/start/route.ts";
const CANCEL = "src/app/api/billing/subscription/cancel/route.ts";
const PROOF = "scripts/qa/tenant-billing-subscription-http.mjs";
const WORKFLOW = ".github/workflows/tenant-billing-subscription-methods.yml";
const YEAR_END_TEST = "tests/tenant-year-end-full-method-candidate.test.mjs";
const read = file => readFileSync(file, "utf8");
const blobSha = file => {
  const b = readFileSync(file);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
};

test("billing route implementation is source-pinned; changes need fresh method proof", () => {
  assert.equal(blobSha(START), "b1330831c4e0ee1b58a713427f572ebbac3c14b1");
  assert.equal(blobSha(CANCEL), "29905df9901734a77c4bdb0597b693fb7b65efe7");
  const start = read(START), cancel = read(CANCEL);
  for (const source of [start, cancel]) {
    assert.match(source, /enforceSameOriginMutation\(request\)/);
    assert.match(source, /await getSessionUser\(\)/);
    assert.match(source, /assertOrganizationRole\(user\.id, organizationId, BILLING_ADMIN_ROLES\)/);
    assert.match(source, /!access\?\.companyWide/);
    assert.match(source, /requireSensitiveActionMfa\(user\)/);
    assert.match(source, /enforceSensitiveActionRateLimit\(request/);
  }
  assert.ok(start.indexOf("assertOrganizationRole") < start.indexOf("createXenditSubscriptionSession("));
  assert.match(start, /sub\.status !== "pending_payment"/);
  assert.match(start, /existing: true/);
  assert.match(start, /EXISTING_CHECKOUT/);
  assert.match(start, /quote\.amountCents !== sub\.amountCents/);
  assert.match(start, /status: "review_required"/);
  assert.match(start, /status: "awaiting_payment"/);
  assert.ok(cancel.indexOf("assertOrganizationRole") < cancel.indexOf("deactivateXenditSubscription("));
  assert.ok(cancel.indexOf("verifyPassword(") < cancel.indexOf("deactivateXenditSubscription("));
  assert.match(cancel, /state\.cancelAtPeriodEnd/);
  assert.match(cancel, /await db\.transaction\(/);
  assert.match(cancel, /PROVIDER_CANCELLATION_NOT_CONFIRMED/);
});

test("fake provider accepts only pre-reviewed Xendit paths and returns fictional sessions", async () => {
  const ref = "linaw_sub_42_" + "a".repeat(32);
  const log = [];
  const result = await simulatedXenditFetch("https://api.xendit.co/sessions", {
    method: "POST",
    body: JSON.stringify({ reference_id: ref, session_type: "SUBSCRIPTION", currency: "PHP", amount: 2000 }),
  }, event => log.push(event));
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.recurring_plan_id, "repl_ci_" + ref);
  assert.equal(payload.payment_link_url, "https://checkout.xendit.co/" + ref);
  const cancelled = await simulatedXenditFetch(
    "https://api.xendit.co/recurring/plans/repl_ci_" + ref + "/deactivate",
    { method: "POST" }, event => log.push(event),
  );
  assert.equal(cancelled.status, 200);
  assert.deepEqual(log.map(event => event.kind), ["start", "cancel"]);
  for (const url of [
    "https://api.xendit.co/invoices", "https://api.xendit.co/recurring/plans/repl_ci_1",
    "https://evil.invalid/sessions", "http://api.xendit.co/sessions",
  ]) {
    assert.throws(() => simulatedXenditFetch(url, { method: "POST" }));
  }
  assert.throws(() => simulatedXenditFetch("https://api.xendit.co/sessions", { method: "GET" }));
  assert.throws(() => simulatedXenditFetch("https://api.xendit.co/sessions", {
    method: "POST", body: JSON.stringify({ reference_id: "victim", session_type: "SUBSCRIPTION", currency: "PHP", amount: 2000 }),
  }));
});

test("isolation fixture refuses any non-local database, live money provider or unsafe flag", () => {
  const valid = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SUBSCRIPTION_PROOF: "fiction-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    XENDIT_BILLING_ENABLED: "true", XENDIT_SECRET_KEY: FIXTURE_KEY,
    XENDIT_CALLBACK_TOKEN: "ci-fictional-callback-no-provider-access",
    XENDIT_BUSINESS_ID: "ci-fictional-business",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    DEMO_MODE: "false",
  };
  assert.doesNotThrow(() => requireFictionalProviderEnv(valid));
  for (const [field, value] of [
    ["CI", "false"], ["DATABASE_URL", "postgresql://prod.example.invalid/app"],
    ["XENDIT_SECRET_KEY", "sk_live_never"], ["XENDIT_BILLING_ENABLED", "false"],
    ["APP_BASE_URL", "https://real-client.example"], ["WORKER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["RESEND_API_KEY", "real-key"],
  ]) {
    assert.throws(() => requireFictionalProviderEnv({ ...valid, [field]: value }),
      "Unsafe config accepted: " + field);
  }
  const runner = read(PROOF);
  assert.ok(runner.indexOf("requireFictionalProviderEnv();") < runner.indexOf('import("../../src/db/index.ts")'),
    "Environment guard must run before database imports");
});

test("real HTTP proof cannot pass on a mere 403, empty 200 or missing victim snapshot", () => {
  const runner = read(PROOF);
  for (const evidence of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "new Set(subjects.map(item => item.cookie))",
    'await request(actor, ownPaths.start',
    "assert.equal(own.status, 201",
    "current.checkouts[0].status, \"awaiting_payment\"",
    "status, \"pending_payment\"",
    'await request(actor, ownPaths.cancel',
    "assert.equal(cancelled.status, 200",
    "assert.equal(replay.json?.alreadyCancelled, true)",
    "assert.deepEqual(await snapshot(victim.org.id), victimBeforeStart",
    "assert.deepEqual(await snapshot(victim.org.id), victimBeforeCancel",
    "methodCredits: 0, productionCertified: false",
  ]) assert.ok(runner.includes(evidence), "Missing asserted proof: " + evidence);
  assert.match(runner, /successfulStarts, 0|successfulStarts = 0/);
  assert.match(runner, /successfulCancels, 0|successfulCancels = 0/);
  assert.match(runner, /Duplicate request must not create a second provider session/);
  assert.match(runner, /Repeated cancellation must not call the provider again/);
});

test("dedicated CI uses PG16, production localhost, no live credentials and exact PR source", () => {
  const wf = read(WORKFLOW);
  assert.match(wf, /image: postgres:16/);
  assert.match(wf, /persist-credentials: false/);
  assert.match(wf, /git rev-parse HEAD/);
  assert.match(wf, /npm run build/);
  assert.match(wf, /node --import tsx scripts\/qa\/tenant-billing-subscription-http\.mjs/);
  assert.match(wf, /tenant-billing-subscription-provider-preload\.mjs/);
  assert.match(wf, /XENDIT_SECRET_KEY: ci-fictional-xendit-key-no-provider-access/);
  assert.match(wf, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(wf, /XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.doesNotMatch(wf, /vercel deploy|db:migrate:production|npm run deploy/i);
  assert.match(read(YEAR_END_TEST), /PG16 candidate exercises both successful POST actions and five GET formats/);
});
