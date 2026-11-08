import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableApprovalTask } from "../scripts/qa/tenant-approval-task-contract.mjs";
import {
  assertInvitationPreviewDenied, assertOwnInvitationPreview, assertReadOnly,
} from "../scripts/qa/tenant-invitation-preview-get-http.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", TENANT_APPROVAL_TASK_MODE: "fictional-pg16-http",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production",
  DEMO_MODE: "false", SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "", STRIPE_SECRET_KEY: "",
};
const blob = (bytes) => createHash("sha1")
  .update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
const fake = (status, json, headers = {}) => ({
  status, json, text: JSON.stringify(json), headers: new Headers(headers),
});
const invitation = {
  token: "fictional-bearer-secret",
  email: "owned@example.invalid", role: "employee",
  row: {
    tokenHash: createHash("sha256").update("fictional-bearer-secret").digest("hex"),
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  },
};

test("proof refuses remote targets, live providers, workers and missing CI markers", () => {
  assert.equal(requireDisposableApprovalTask(safe), true);
  for (const mutation of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { TENANT_APPROVAL_TASK_MODE: "other" }, { NODE_ENV: "development" },
    { DATABASE_URL: "postgresql://postgres:postgres@production.example/app_db" },
    { SECURITY_SMOKE_URL: "https://payrollsoftware.ph" },
    { WORKER_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { SMTP_URL: "smtp://127.0.0.1:2525" }, { RESEND_API_KEY: "real-key" },
    { STRIPE_SECRET_KEY: "real-key" },
  ]) assert.throws(() => requireDisposableApprovalTask({ ...safe, ...mutation }), /REFUSED/);
});

test("positive preview requires the exact token-owned email, role, expiry and minimal fields", () => {
  const good = fake(200, {
    valid: true, email: invitation.email, role: invitation.role,
    expiresAt: invitation.row.expiresAt.toISOString(),
  }, { "cache-control": "private, no-store" });
  assert.doesNotThrow(() => assertOwnInvitationPreview(good, invitation));
  for (const bad of [
    fake(404, good.json),
    fake(200, { ...good.json, email: "victim@example.invalid" }),
    fake(200, { ...good.json, role: "owner" }),
    fake(200, { ...good.json, organizationId: 99 }),
    fake(200, { ...good.json, expiresAt: "2031-01-01T00:00:00Z" }),
    fake(200, good.json, { "cache-control": "public, max-age=3600" }),
    fake(200, { ...good.json, tokenHash: invitation.row.tokenHash }),
  ]) assert.throws(() => assertOwnInvitationPreview(bad, invitation));
});

test("all invalid, consumed and foreign-ID-only previews must be uniform and leak nothing", () => {
  assert.doesNotThrow(() => assertInvitationPreviewDenied(fake(404, { valid: false }),
    ["victim@example.invalid", "secret-victim-marker"]));
  for (const bad of [
    fake(200, { valid: true }),
    fake(404, { valid: false, email: "victim@example.invalid" }),
    fake(404, { valid: false, reason: "expired" }),
    fake(403, { valid: false }),
    fake(404, { valid: false }, { "x-debug": "secret-victim-marker" }),
  ]) assert.throws(() => assertInvitationPreviewDenied(bad,
    ["victim@example.invalid", "secret-victim-marker"]));
});

test("negative control catches mutation in any employer snapshot", () => {
  const before = { employer: [1], invitations: [{ acceptedAt: null }], audit: [] };
  assert.doesNotThrow(() => assertReadOnly(before, structuredClone(before), "fictional"));
  assert.throws(() => assertReadOnly(before, {
    ...before, invitations: [{ acceptedAt: new Date() }],
  }, "fictional"));
});

test("runtime GET still derives the employer solely from the bearer token", () => {
  const routePath = "src/app/api/invitations/accept/route.ts";
  const source = readFileSync(routePath, "utf8");
  const helper = readFileSync("src/lib/tokens.ts", "utf8");
  // A future route/helper change requires a new exact-source CI receipt,
  // not a borrowed positive from an earlier implementation.
  assert.equal(blob(readFileSync(routePath)), "1ce20257f7f3efa9ca380712d4dd485397a06814");
  assert.equal(blob(readFileSync("src/lib/tokens.ts")), "a13f719b62cfb34f82f496e984987d82168bc262");
  const get = source.split("export async function GET(request: Request) {")[1]
    ?.split("export async function POST(request: Request) {")[0];
  assert.ok(get);
  assert.match(get, /findUsableInvitation\(token\)/);
  assert.match(get, /searchParams\.get\("token"\)/);
  assert.doesNotMatch(get, /searchParams\.get\("(?:organizationId|invitationId|userId|role|email)"\)/);
  assert.match(helper, /eq\(invitations\.tokenHash, sha256\(token\)\)/);
  assert.match(helper, /isNull\(invitations\.acceptedAt\)/);
  assert.match(helper, /gt\(invitations\.expiresAt, new Date\(\)\)/);
});

test("real HTTP proof cannot use fake positives, skip real victim or claim coverage", () => {
  const runner = readFileSync("scripts/qa/tenant-invitation-preview-get-http.mjs", "utf8");
  assert.ok(runner.indexOf("requireDisposableApprovalTask();") <
    runner.indexOf('import("../../src/db/index.ts")'));
  for (const marker of [
    'seedEmployer("ATTA"', 'seedEmployer("ATTB"', 'seedEmployer("VICTIM"',
    "victimInvite.row.id >", "assertOwnInvitationPreview(aResponse, ownA)",
    "assertOwnInvitationPreview(bResponse, ownB)", "assertInvitationPreviewDenied(response, forbidden)",
    "allThreeEmployerStatesUnchanged: true", "assertReadOnly(baseline.get(employer.org.id)",
    "unconsumedA.acceptedAt", "unconsumedB.acceptedAt", "coverageCredits: 0",
    'independentSecurityReview: "PENDING"', "productionTested: false",
  ]) assert.ok(runner.includes(marker), "missing essential proof: " + marker);
  assert.doesNotMatch(runner, /coverageCredits:\s*[1-9]/);
});

test("separate GitHub Actions job remains read-only, localhost, PG16 and path-scoped", () => {
  const yml = readFileSync(".github/workflows/tenant-invitation-preview-get-http.yml", "utf8");
  for (const marker of [
    "image: postgres:16", "contents: read", "persist-credentials: false",
    "npm run db:push", "node --import tsx scripts/qa/tenant-invitation-preview-get-http.mjs",
    "node --test tests/tenant-invitation-preview-get-contract.test.mjs",
    "'scripts/qa/tenant-invitation-preview-get-http.mjs'",
    "'tests/tenant-invitation-preview-get-contract.test.mjs'",
    "WORKER_ENABLED: 'false'", "XENDIT_PAYOUTS_ENABLED: 'false'",
  ]) assert.ok(yml.includes(marker), "missing job safety marker: " + marker);
  assert.doesNotMatch(yml, /secrets\.|workflow_dispatch/);
});
