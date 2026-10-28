import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  requireDisposableSelfProfile, assertNoProfileMarker,
  assertProfileDenied, assertOwnProfileMutation,
} from "../scripts/qa/tenant-self-profile-contract.mjs";

const safe = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", TENANT_SECOND_PASS_MODE: "isolated-ci-only", NODE_ENV: "production",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", DEMO_MODE: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", XENDIT_PAYOUT_SECRET_KEY: "",
  RESEND_API_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "",
});
const actor = {
  org: { id: 11 },
  worker: { id: 21, employeeNo: "FAKE-A-21" },
  ess: { id: 41, name: "Fictional Employee A" },
};
const expected = {
  mobile: "09171234567",
  emergencyContact: "FAKE-A-OWN-EMERGENCY",
  emergencyPhone: "09087654321",
};
function evidence() {
  const before = {
    employees: [
      { id: 21, organizationId: 11, employeeNo: "FAKE-A-21", mobile: null,
        emergencyContact: null, emergencyPhone: null, basicRate: "20000.00" },
      { id: 22, organizationId: 11, employeeNo: "FAKE-A-PEER",
        mobile: "09000000001", emergencyContact: "PEER-PRIVATE",
        emergencyPhone: "09000000002", basicRate: "90000.00" },
    ],
    payroll: [{ id: 5, organizationId: 11, status: "Draft" }],
    payProfiles: [{ id: 3, organizationId: 11, rateAmount: "20000.00" }],
    punches: [{ id: 2, organizationId: 11, employeeId: 21 }],
    orgUnits: [{ id: 7, organizationId: 11 }],
    legalEntities: [{ id: 8, organizationId: 11 }],
    audit: [{ id: 61, organizationId: 11, action: "Previous audit", metadata: {} }],
  };
  const after = structuredClone(before);
  Object.assign(after.employees[0], expected);
  after.audit.push({
    id: 62, organizationId: 11, actor: actor.ess.name,
    action: "Employee self-service profile updated", resource: actor.worker.employeeNo,
    metadata: { employeeId: 21, fields: ["mobile", "emergencyContact", "emergencyPhone"],
      payrollSensitiveFieldsChanged: false },
  });
  const response = {
    status: 200, json: { profile: { ...expected } },
    text: JSON.stringify({ profile: expected }), headers: new Headers(),
  };
  return { before, after, response };
}

test("profile proof can run only with isolated CI PG16 and disabled workers/providers", () => {
  assert.equal(requireDisposableSelfProfile(safe), true);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["TENANT_SECOND_PASS_MODE", "live"],
    ["NODE_ENV", "development"], ["SECURITY_SMOKE_URL", "https://payroll.example.invalid"],
    ["SECURITY_SMOKE_URL", "http://localhost:3000"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5433/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/customer"],
    ["DATABASE_URL", "postgresql://other:secret@127.0.0.1:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require"],
    ["WORKER_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["DEMO_MODE", "true"],
    ["PAYMONGO_SECRET_KEY", "real"], ["XENDIT_SECRET_KEY", "real"],
    ["XENDIT_PAYOUT_SECRET_KEY", "real"], ["RESEND_API_KEY", "real"],
    ["POSTMARK_SERVER_TOKEN", "real"], ["SMTP_URL", "smtp://mail.example.invalid"],
    ["NEON_API_KEY", "real"], ["NEON_DATABASE_URL", "postgresql://hosted.invalid/db"],
  ]) {
    assert.throws(() => requireDisposableSelfProfile({ ...safe, [key]: value }),
      /ESS_PROFILE_REFUSED/, key);
  }
  assert.throws(() => requireDisposableSelfProfile({ ...safe, DATABASE_URL: undefined }),
    /ESS_PROFILE_REFUSED/);
});

test("own PATCH needs real persisted contact changes and an actor-bound audit", () => {
  const { before, after, response } = evidence();
  assert.equal(assertOwnProfileMutation(before, after, actor, response, expected).mobile,
    expected.mobile);
});

test("false positive PATCH, other worker edit, payroll edit or audit omission fails", () => {
  const corruptions = [
    x => { x.after = structuredClone(x.before); },
    x => { x.after.employees[0].mobile = "09170009999"; },
    x => { x.after.employees[0].basicRate = "90000.00"; },
    x => { x.after.employees[0].organizationId = 99; },
    x => { x.after.employees[1].mobile = "09990000000"; },
    x => { x.after.employees.push({ id: 99, organizationId: 99 }); },
    x => { x.after.payroll[0].status = "Released"; },
    x => { x.after.payProfiles[0].rateAmount = "100000.00"; },
    x => { x.after.punches[0].employeeId = 99; },
    x => { x.after.orgUnits[0].organizationId = 99; },
    x => { x.after.legalEntities[0].organizationId = 99; },
    x => { x.after.audit.pop(); },
    x => { x.after.audit[0].action = "Rewritten old audit"; },
    x => { x.after.audit[1].organizationId = 99; },
    x => { x.after.audit[1].actor = "Wrong employee"; },
    x => { x.after.audit[1].metadata.employeeId = 99; },
    x => { x.after.audit[1].metadata.payrollSensitiveFieldsChanged = true; },
    x => { x.after.audit.push({ ...x.after.audit[1], id: 63 }); },
    x => { x.response.status = 403; },
    x => { x.response.json.profile.mobile = "victim phone"; },
    x => { x.response.json.profile.basicRate = "10000"; },
  ];
  for (const change of corruptions) {
    const x = evidence();
    change(x);
    assert.throws(() => assertOwnProfileMutation(x.before, x.after, actor, x.response, expected));
  }
});

test("denied requests have exact status, no editable profile and no private markers", () => {
  const deny = { status: 403, json: { error: "Forbidden" },
    text: '{"error":"Forbidden"}', headers: new Headers() };
  assertProfileDenied(deny, 403, ["FICTIONAL-VICTIM-PRIVATE"]);
  assert.throws(() => assertProfileDenied({ ...deny, status: 200 }, 403));
  assert.throws(() => assertProfileDenied({ ...deny, json: { profile: expected } }, 403));
  assert.throws(() => assertProfileDenied({ ...deny, text: "FICTIONAL-VICTIM-PRIVATE" },
    403, ["FICTIONAL-VICTIM-PRIVATE"]));
  assert.throws(() => assertNoProfileMarker({ ...deny,
    headers: new Headers({ "x-employee": "FICTIONAL-VICTIM-PRIVATE" }) },
  "FICTIONAL-VICTIM-PRIVATE"));
});

test("existing profile route derives identity from session and only allows contact fields", () => {
  const source = readFileSync("src/app/api/self/profile/route.ts", "utf8");
  assert.match(source, /session\.role !== "employee" \|\| !session\.employeeId/);
  assert.match(source, /assertMembership\(session\.id, employee\.organizationId\)/);
  assert.ok(source.indexOf("assertMembership(") < source.indexOf("tx.update(employees)"));
  assert.match(source, /where\(eq\(employees\.id, session\.employeeId\)\)/);
  assert.match(source, /enforceSameOriginMutation\(request\)/);
  assert.match(source, /publicDemoMutationDenied\(/);
  for (const field of ["mobile", "emergencyContact", "emergencyPhone"]) {
    assert.ok(source.includes(field + ": clean(body." + field));
  }
  assert.doesNotMatch(source, /searchParams\.get\("employeeId"\)/);
  assert.doesNotMatch(source, /searchParams\.get\("organizationId"\)/);
  assert.doesNotMatch(source, /basicRate: clean\(body\./);
  assert.doesNotMatch(source, /bankAccount: clean\(body\./);
  assert.match(source, /db\.transaction\(async \(tx\) =>/);
  assert.match(source, /tx\.select\(\{[\s\S]*?id: employees\.id/);
  assert.match(source, /eq\(employees\.organizationId, employee\.organizationId\)/);
  assert.match(source, /for\("update"\)\.limit\(1\)/);
  assert.match(source, /tx\.select\(\{[\s\S]*?id: userOrganizations\.id/);
  assert.match(source, /eq\(userOrganizations\.userId, session\.id\)/);
  assert.match(source, /eq\(userOrganizations\.active, true\)/);
  assert.match(source, /for\("share"\)\.limit\(1\)/);
  assert.match(source, /membership\.workerEmployeeId !== boundEmployee\.id/);
  assert.match(source, /eq\(employees\.organizationId, boundEmployee\.organizationId\)/);
  assert.match(source, /await tx\.insert\(auditEvents\)\.values\(\{/);
  assert.ok(source.indexOf("tx.update(employees)") <
    source.indexOf("tx.insert(auditEvents)"),
    "contact and actor-bound audit must share a SQL transaction");
  assert.doesNotMatch(source, /recordAuditEvent\(/);
});

test("the original #1518 source-pinned HTTP runner remains byte-for-byte intact", () => {
  const original = readFileSync("scripts/qa/tenant-self-profile-http.mjs", "utf8");
  const bytes = Buffer.from(original, "utf8");
  const blob = createHash("sha1").update("blob " + bytes.length + "\0")
    .update(bytes).digest("hex");
  assert.equal(blob, "3e7b9502c2ad23b97f20f1ad045703fcd0a97789",
    "new atomicity proof must not rewrite the earlier successful own/victim receipt");
});

test("focused workflow must execute the real PG16 localhost runner rather than a mocked response", () => {
  const workflow = readFileSync(".github/workflows/tenant-self-profile-http.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-self-profile-atomic-http.mjs", "utf8");
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /npm run db:push/);
  assert.match(workflow, /apply-isolated-baseline\.mjs/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /node --import tsx scripts\/qa\/tenant-self-profile-atomic-http\.mjs/);
  assert.ok(runner.indexOf("requireDisposableSelfProfile();")
    < runner.indexOf('import("../../src/db/index.ts")'),
    "fail closed before any application or database imports");
  assert.match(runner, /seed\("ATTA"\)/);
  assert.match(runner, /seed\("ATTB"\)/);
  assert.match(runner, /seed\("VICTIM"\)/);
  assert.match(runner, /db\.update\(userOrganizations\)\.set\(\{ active: false \}\)/);
  assert.match(runner, /assert\.deepEqual\(await snapshot\(victim\.org\.id\), victimBefore/);
  assert.match(runner, /workerEmployeeId: first\.peer\.id/);
  assert.match(runner, /CREATE FUNCTION ci_self_profile_reject_audit/);
  // The audit-veto fixture must parse in PostgreSQL before it can exercise
  // rollback. Single-dollar delimiters are invalid PL/pgSQL dollar quoting.
  const auditSql = runner.match(/CREATE FUNCTION ci_self_profile_reject_audit[\s\S]*?CREATE TRIGGER ci_self_profile_reject_audit/)?.[0];
  assert.ok(auditSql, "fixture must define the test-only audit veto trigger");
  assert.match(auditSql, /LANGUAGE plpgsql AS \$ci_profile_audit\$/);
  assert.match(auditSql, /END;\s*\$ci_profile_audit\$;/);
  assert.equal(auditSql.split("$ci_profile_audit$").length, 3,
    "PL/pgSQL function must have exactly two matching dollar-quote delimiters");
  assert.match(runner, /CREATE TRIGGER ci_self_profile_reject_audit/);
  assert.match(runner, /DROP TRIGGER IF EXISTS ci_self_profile_reject_audit/);
  assert.match(runner, /failed audit transaction cannot commit an unaudited contact change/);
  assert.match(runner, /profileAuditRollbackProven: true/);
  assert.doesNotMatch(runner, /https:\/\/(?!example\.invalid)/);
});
