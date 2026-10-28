import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  METHOD, ENDPOINT, requireDisposableTreasury, assertNoTreasuryLeak,
  assertTreasuryDenied, assertUnchangedTreasury, assertSavedTreasury,
} from "../scripts/qa/tenant-mny02-treasury-contract.mjs";

const safe = {
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_TREASURY_MODE: "fictional-mny02-only",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  REQUIRE_PRIVILEGED_MFA: "true", DEMO_MODE: "false",
  TRUSTED_APP_ORIGINS: "http://127.0.0.1:3000",
  APP_BASE_URL: "https://payroll.example.test",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
};
function response(status, json, extraHeaders = {}) {
  return { status, json, text: JSON.stringify(json),
    headers: new Headers(extraHeaders) };
}
function fixture() {
  const actor = { org: { id: 11 }, owner: { id: 23, name: "FICTIONAL OWNER" } };
  const before = {
    organizations: [{ id: 11 }], staff: [{ id: 17 }],
    payProfiles: [{ id: 19 }], payroll: [], payoutChanges: [],
    memberships: [{ id: 21 }], members: [{ id: 23 }],
    policies: [], assignments: [], audit: [{ id: 29, action: "fixture" }],
  };
  const time = new Date("2026-10-28T06:00:00.000Z");
  const after = {
    ...before,
    policies: [{
      organizationId: 11, enabled: true, enabledAt: time,
      createdByUserId: 23, updatedByUserId: 23,
      requireReleaseSubmitterSeparation: true,
    }],
    assignments: [{
      id: 31, organizationId: 11, userId: 25, active: true,
      updatedByUserId: 23,
    }],
    audit: [...before.audit, {
      id: 30, organizationId: 11, actor: actor.owner.name,
      action: "Treasury separation policy enabled or updated",
      resource: "Payroll treasury controls",
      metadata: {
        enabled: true, requireReleaseSubmitterSeparation: true,
        operatorUserIds: [25], configuredByUserId: 23,
      },
    }],
  };
  const ok = response(200, {
    enabled: true, requireReleaseSubmitterSeparation: true,
    operatorUserIds: [25], enabledAt: time.toISOString(),
  });
  return { actor, before, after, ok, options: {
    enabled: true, separation: true, operatorUserIds: [25],
    foreignMarkers: ["FICTIONAL-VICTIM-PRIVATE"],
  }};
}

test("MNY-02 exact route remains GAP; source hash matches and no silent credit", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const path = "src/app/api/treasury-controls/route.ts";
  const row = manifest.allApiRouteFiles[path];
  assert.equal(METHOD, "POST treasury-controls");
  assert.equal(ENDPOINT, "/api/treasury-controls");
  assert.equal(row.route, "treasury-controls");
  assert.equal(row.methods.find(m => m.name === "POST").status, "GAP");
  assert.equal(row.methods.find(m => m.name === "POST").testedBy, null);
  const code = readFileSync(path, "utf8");
  const bytes = Buffer.from(code, "utf8");
  const blob = createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
  assert.equal(blob, "bb5b9cd2b0a0ca2d9ec3d66bfab80ebdf344d653");
  assert.equal(row.gitBlobSha, blob);
  assert.match(code, /export async function POST\(request: Request\)/);
  assert.match(code, /TREASURY_POLICY_ADMIN_ROLES = \["owner"\]/);
  assert.match(code, /eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(code, /operatorUserIds/);
  assert.match(code, /requireSensitiveActionMfa\(user\)/);
  assert.match(code, /if \(pendingPayoutChange\)/);
  assert.match(code, /db\.transaction\(async \(tx\) =>/);
  assert.match(code, /await recordAuditEvent\(/);
});

test("disposable guard refuses hosted systems, other DBs, money and external secrets", () => {
  assert.doesNotThrow(() => requireDisposableTreasury(safe));
  const invalids = [
    ["CI", "false"], ["GITHUB_ACTIONS", "false"],
    ["NODE_ENV", "development"],
    ["DATABASE_URL", "postgresql://postgres:postgres@db.hosted.invalid:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/production"],
    ["DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/app_db"],
    ["SECURITY_SMOKE_URL", "https://127.0.0.1:3000"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.attacker.invalid:3000"],
    ["APP_BASE_URL", "https://payroll.example.com"],
    ["TRUSTED_APP_ORIGINS", "https://attacker.invalid"],
    ["REQUIRE_PRIVILEGED_MFA", "false"],
    ["TENANT_TREASURY_MODE", "anything-else"],
    ["XENDIT_BILLING_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["WORKER_ENABLED", "true"],
    ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "live-secret"],
    ["XENDIT_SECRET_KEY", "live-secret"],
    ["RESEND_API_KEY", "live-secret"],
    ["NEON_DATABASE_URL", "postgresql://live"],
  ];
  for (const [name, value] of invalids) assert.throws(
    () => requireDisposableTreasury({ ...safe, [name]: value }),
    /MNY02_TREASURY_REFUSED/, name + " must be a pre-import safety failure");
});

test("two own-persistent changes cannot be simulated with fake success or missing audit", () => {
  const f = fixture();
  assert.doesNotThrow(() => assertSavedTreasury(
    f.before, f.after, f.ok, f.actor, f.options));
  const mutations = [
    x => { x.ok.status = 403; },
    x => { x.ok.json.operatorUserIds = []; x.ok.text = JSON.stringify(x.ok.json); },
    x => { x.after.policies = []; },
    x => { x.after.policies[0].organizationId = 99; },
    x => { x.after.policies[0].enabled = false; },
    x => { x.after.policies[0].updatedByUserId = 900; },
    x => { x.after.assignments[0].organizationId = 99; },
    x => { x.after.assignments[0].active = false; },
    x => { x.after.audit = x.before.audit; },
    x => { x.after.audit[1].organizationId = 99; },
    x => { x.after.audit[1].metadata.configuredByUserId = 99; },
    x => { x.after.payroll = [{ id: 999, changed: true }]; },
    x => { x.after.memberships = []; },
    x => { x.ok.headers.set("x-foreign", "FICTIONAL-VICTIM-PRIVATE"); },
    x => { x.ok.json.enabledAt = "wrong-timestamp"; },
  ];
  for (const mutate of mutations) {
    const x = fixture(); mutate(x);
    assert.throws(() => assertSavedTreasury(
      x.before, x.after, x.ok, x.actor, x.options),
    "mutation must be detected rather than credited");
  }
});

test("denied requests never expose policy success, operator, private body or headers", () => {
  assert.doesNotThrow(() => assertTreasuryDenied(
    response(403, { error: "Not authorized." }), 403,
    ["FICTIONAL-VICTIM-PRIVATE"]));
  for (const result of [
    response(200, { error: "Not authorized." }),
    response(403, { enabled: true, error: "Not authorized." }),
    response(403, { operatorUserIds: [888], error: "Denied" }),
    response(403, { error: "FICTIONAL-VICTIM-PRIVATE" }),
    response(403, { error: "Denied" }, { "x-leak": "FICTIONAL-VICTIM-PRIVATE" }),
  ]) assert.throws(() => assertTreasuryDenied(result, 403,
    ["FICTIONAL-VICTIM-PRIVATE"]));
  const f = fixture();
  assert.doesNotThrow(() => assertUnchangedTreasury(f.before, f.before));
  assert.throws(() => assertUnchangedTreasury(f.before, f.after));
  assert.throws(() => assertNoTreasuryLeak(
    response(403, { error: "Denied" }, { location: "FICTIONAL-VICTIM-PRIVATE" }),
    ["FICTIONAL-VICTIM-PRIVATE"]));
});

test("workflow uses real PostgreSQL 16 localhost HTTP, no providers and no manifest credit", () => {
  const yaml = readFileSync(".github/workflows/tenant-mny02-treasury-http.yml", "utf8");
  const script = readFileSync("scripts/qa/tenant-mny02-treasury-http.mjs", "utf8");
  assert.match(yaml, /image: postgres:16/);
  assert.match(yaml, /npm run db:push/);
  assert.match(yaml, /apply-isolated-baseline\.mjs/);
  assert.match(yaml, /npm run build/);
  assert.match(yaml, /npm start -- -H 127\.0\.0\.1/);
  assert.match(yaml, /node --import tsx scripts\/qa\/tenant-mny02-treasury-http\.mjs/);
  assert.match(yaml, /PAYMONGO_DISBURSEMENTS_ENABLED=false/);
  assert.match(yaml, /XENDIT_PAYOUTS_ENABLED=false/);
  assert.match(yaml, /XENDIT_BILLING_ENABLED=false/);
  assert.match(script, /requireDisposableTreasury\(\);/);
  assert.match(script, /server_version_num/);
  assert.match(script, /victimSuccess = await post\(victim/);
  assert.match(script, /for \(const e of \[a, b\]\)/);
  assert.match(script, /assertUnchangedTreasury\(victimBeforeAttacks/);
  assert.match(script, /forgedOperatorDenials\+\+/);
  assert.match(script, /assertSavedTreasury\(/);
  assert.match(script, /MNY02_TREASURY_PROOF_OK/);
  assert.ok(!yaml.includes("api.paymongo.com") &&
    !yaml.includes("api.xendit.co"));
});
