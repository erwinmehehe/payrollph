import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  requireDisposablePayrollApprovers, proveRows,
} from "../scripts/qa/tenant-payroll-approvers-http.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only", DEMO_MODE: "false",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
};

test("payroll checker tenant proof only runs with truly disposable localhost PG16 and providers OFF", () => {
  assert.equal(requireDisposablePayrollApprovers(safe), true);
  for (const [key, value] of [
    ["GITHUB_ACTIONS", "false"], ["CI", "false"], ["NODE_ENV", "development"],
    ["TENANT_SECOND_PASS_MODE", "staging"], ["DEMO_MODE", "true"],
    ["DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/app_db"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/customer"],
    ["DATABASE_URL", "postgresql://other:password@127.0.0.1:5432/app_db"],
    ["SECURITY_SMOKE_URL", "https://payroll.example.test"],
    ["SECURITY_SMOKE_URL", "http://127.0.0.1.evil:3000"],
    ["WORKER_ENABLED", "true"], ["CENTRAL_SCHEDULER_ENABLED", "true"],
    ["XENDIT_BILLING_ENABLED", "true"], ["XENDIT_PAYOUTS_ENABLED", "true"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "true"],
    ["PAYMONGO_SECRET_KEY", "live"], ["XENDIT_SECRET_KEY", "live"],
    ["RESEND_API_KEY", "live"], ["POSTMARK_SERVER_TOKEN", "live"],
    ["SMTP_URL", "smtp://provider.example.test:587"], ["STRIPE_SECRET_KEY", "live"],
  ]) {
    assert.throws(() => requireDisposablePayrollApprovers({ ...safe, [key]: value }),
      /PAYROLL_APPROVERS_PROOF_REFUSED/, key);
  }
  assert.throws(() => requireDisposablePayrollApprovers({ ...safe, GITHUB_ACTIONS: undefined }),
    /PAYROLL_APPROVERS_PROOF_REFUSED/);
  assert.throws(() => requireDisposablePayrollApprovers({ ...safe, DATABASE_URL: undefined }),
    /PAYROLL_APPROVERS_PROOF_REFUSED/);
});

const checker = (id, name, role = "checker") => ({
  id, name, email: name.toLowerCase().replaceAll(" ", "-") + "@example.invalid",
  role, orgUnitId: 3,
});
const valid = () => ({ approvers: [
  checker(12, "Fictional A"), checker(14, "Fictional B", "manager"),
] });

test("result assertions discriminate nonempty own employee rows from wrong/extra/foreign checkers", () => {
  proveRows(valid(), [12, 14], ["Fictional C"]);
  assert.throws(() => proveRows({ approvers: [] }, [12, 14]));
  assert.throws(() => proveRows(valid(), [12, 19]));
  assert.throws(() => proveRows(valid(), [12, 14], ["Fictional B"]));
  assert.throws(() => proveRows({ approvers: [...valid().approvers].reverse() }, [12, 14]));
  assert.throws(() => proveRows({ approvers: [checker(12, "Fictional A", "employee")] }, [12]));
  assert.throws(() => proveRows({
    approvers: [{ ...checker(12, "Fictional A"), tokenHash: "private" }],
  }, [12]));
});

test("DB applies live membership, active user, role, peer and unit predicates before returning PII", () => {
  const s = readFileSync("src/app/api/organizations/[id]/payroll-approvers/route.ts", "utf8");
  assert.match(s, /getSessionUser\(\)/);
  assert.match(s, /assertOrganizationRole\(/);
  assert.match(s, /getAccess\(user\.id, organizationId\)/);
  assert.match(s, /Number\.isSafeInteger\(organizationId\)/);
  assert.match(s, /eq\(userOrganizations\.organizationId, organizationId\)/);
  assert.match(s, /eq\(userOrganizations\.active, true\)/);
  assert.match(s, /eq\(users\.active, true\)/);
  assert.match(s, /inArray\(userOrganizations\.role, \[\.\.\.PAYROLL_CHECKER_ROLES\]\)/);
  assert.match(s, /ne\(userOrganizations\.userId, user\.id\)/);
  assert.match(s, /eq\(userOrganizations\.orgUnitId, candidateUnitId\)/);
  assert.match(s, /"Cache-Control": "private, no-store"/);
  assert.ok(s.indexOf("getAccess(user.id, organizationId)") < s.indexOf("const rows = await db"),
    "role/assigned-unit scope must be resolved before selecting names and emails");
  assert.ok(s.indexOf("eq(userOrganizations.active, true)") > s.indexOf(".where(and("),
    "SQL must reject revoked grants, not only JS filter them after projection");
  assert.ok(!s.includes("export async function POST"));
});

test("dedicated workflow executes real built Next HTTP on fresh fictional PG16, never production", () => {
  const workflow = readFileSync(".github/workflows/tenant-payroll-approvers-http.yml", "utf8");
  const runner = readFileSync("scripts/qa/tenant-payroll-approvers-http.mjs", "utf8");
  for (const required of [
    "image: postgres:16", "npm ci", "npm run db:push",
    "apply-isolated-baseline.mjs", "npm run build",
    "node --import tsx scripts/qa/tenant-payroll-approvers-http.mjs",
    "node --test tests/tenant-payroll-approvers-contract.test.mjs",
  ]) assert.ok(workflow.includes(required), required);
  assert.match(workflow, /WORKER_ENABLED=false/);
  assert.match(workflow, /CENTRAL_SCHEDULER_ENABLED=false/);
  assert.match(workflow, /XENDIT_BILLING_ENABLED=false/);
  assert.match(runner, /requireDisposablePayrollApprovers\(\); \/\/ BEFORE any DB or server module import/);
  assert.match(runner, /seedEmployer\("ATTA"/);
  assert.match(runner, /seedEmployer\("ATTB"/);
  assert.match(runner, /seedEmployer\("VICTIM"/);
  assert.match(runner, /assert\.deepEqual\(await snapshot\(\), before/);
  assert.match(runner, /methodCredits: 0, independentAcceptance: false/);
});
