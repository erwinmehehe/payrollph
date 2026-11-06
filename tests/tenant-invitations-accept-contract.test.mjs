import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableApprovalTask } from "../scripts/qa/tenant-approval-task-contract.mjs";

const route = () => readFileSync("src/app/api/invitations/accept/route.ts", "utf8");
const harness = () => readFileSync("scripts/qa/tenant-invitations-accept-http.mjs", "utf8");
const workflow = () => readFileSync(".github/workflows/tenant-invitations-accept-http.yml", "utf8");
const safe = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production", DEMO_MODE: "false",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
};

test("the pre-import disposable target guard refuses production or active providers", () => {
  assert.equal(requireDisposableApprovalTask(safe), true);
  for (const mutation of [
    { CI: "false" }, { NODE_ENV: "development" }, { GITHUB_ACTIONS: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@remote.example/app_db" },
    { SECURITY_SMOKE_URL: "https://payrollsoftware.ph" },
    { WORKER_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" }, { RESEND_API_KEY: "live" },
    { SMTP_URL: "smtp://127.0.0.1:2525" },
  ]) {
    assert.throws(() => requireDisposableApprovalTask({ ...safe, ...mutation }), /REFUSED/);
  }
});

test("the acceptance handler derives membership only from the invitation bearer token", () => {
  const post = route().split("export async function POST(request: Request)")[1];
  assert.ok(post, "POST handler must exist");
  assert.match(post, /enforceSameOriginMutation\(request\)/);
  assert.match(post, /findUsableInvitation\(token\)/);
  assert.match(post, /eq\(users\.email,\s*invitation\.email\)/);
  assert.match(post, /organizationId:\s*invitation\.organizationId/);
  assert.match(post, /role:\s*invitation\.role/);
  assert.match(post, /orgUnitId:\s*invitation\.orgUnitId/);
  for (const forbidden of ["body.organizationId", "body.orgUnitId", "body.role", "body.userId", "body.email"]) {
    assert.ok(!post.includes(forbidden), "a forged request selector became authoritative: " + forbidden);
  }
});

test("the invite unit must be active and belong to the invited employer before claiming the token", () => {
  const post = route().split("export async function POST(request: Request)")[1];
  const txAt = post.indexOf("db.transaction(async (tx) => {");
  const unitAt = post.indexOf("if (invitation.orgUnitId !== null)", txAt);
  const claimAt = post.indexOf("tx.update(invitations)", txAt);
  const grantAt = post.indexOf("tx.insert(userOrganizations)", txAt);
  assert.ok(txAt >= 0 && unitAt > txAt && claimAt > unitAt && grantAt > claimAt,
    "unit scope must be checked inside the same transaction before token claim and membership");
  const unitGuard = post.slice(unitAt, claimAt);
  assert.match(unitGuard, /tx\.select\(\{\s*id:\s*orgUnits\.id\s*\}\)\.from\(orgUnits\)/);
  assert.match(unitGuard, /eq\(orgUnits\.id,\s*invitation\.orgUnitId\)/);
  assert.match(unitGuard, /eq\(orgUnits\.organizationId,\s*invitation\.organizationId\)/);
  assert.match(unitGuard, /eq\(orgUnits\.active,\s*true\)/);
  assert.match(unitGuard, /if \(!scopedUnit\) return null/);
  assert.match(post, /isNull\(invitations\.acceptedAt\)/);
  assert.match(post, /gt\(invitations\.expiresAt,\s*new Date\(\)\)/);
});

test("the real HTTP harness proves both independent acceptances and untouched higher-ID victim", () => {
  const source = harness();
  assert.ok(source.indexOf("requireDisposableApprovalTask();") <
    source.indexOf('import("../../src/db/index.ts")'), "unsafe import before disposable guard");
  for (const required of [
    "seedEmployer(\"ATTA\"", "seedEmployer(\"ATTB\"", "seedEmployer(\"VICTIM\"",
    "for (let i = 0; i < 7; i++)", "victimInvitation.row.id >",
    "await post(poisoned[key].token)", "foreign-unit invitation must be refused",
    "inactive own unit must also fail closed", "cross-site acceptance must be refused",
    "forged organizationId was ignored", "forged foreign org unit was ignored",
    "exactly one own audit event", "single-use token created exactly one account",
    "A and B prove independent own successes", "entire higher-ID victim remains byte-identical",
    "coverageCredits: 0", "independentlyAccepted: false",
  ]) assert.ok(source.includes(required), "missing essential proof: " + required);
  assert.doesNotMatch(source, /coverageCredits:\s*[1-9]/);
});

test("the workflow is isolated, fictional-only, path-scoped, and has no secrets or write permission", () => {
  const yml = workflow();
  for (const required of [
    "image: postgres:16", "contents: read", "persist-credentials: false",
    "node --test tests/tenant-invitations-accept-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-invitations-accept-http.mjs",
    "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
    "'src/app/api/invitations/accept/**'",
    "'scripts/qa/tenant-invitations-accept-http.mjs'",
    "'tests/tenant-invitations-accept-contract.test.mjs'",
  ]) assert.ok(yml.includes(required), "missing workflow safety gate: " + required);
  assert.doesNotMatch(yml, /secrets\./);
  assert.doesNotMatch(yml, /workflow_dispatch/);
});
