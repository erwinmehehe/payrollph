/** CI wiring only; real tenant coverage still requires the HTTP/PG16 runner. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/salary-correction-cases-qa.yml", "utf8");
const serverName = "Start isolated production-mode localhost server";
const probeName = "Signed-in own-employer success and victim-employer denial over HTTP";
const flagLine = '          LOCAL_LOGIN_AUDIT_ENABLED: "true"\n';
const guardRun = "node --test tests/hcm-salary-correction-cases-workflow.test.mjs";

// Pin explicit step-local YAML, not a matching comment or the HTTP client's env.
function step(source, name) {
  const lines = source.split("\n");
  const start = lines.indexOf("      - name: " + name);
  assert.ok(start >= 0, "Missing mandatory step: " + name);
  const next = lines.findIndex((line, i) => i > start && /^      - /.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join("\n");
}

function requireServerAudit(source) {
  const server = step(source, serverName);
  const env = server.match(/^        env:\n((?:          [^\n]*\n)+)/m)?.[1];
  assert.ok(env, "The isolated server must have an explicit step-local environment");
  assert.ok(env.includes(flagLine), "Enable exact LOCAL_LOGIN_AUDIT_ENABLED=true on the isolated server");
  assert.equal([...source.matchAll(/^\s*LOCAL_LOGIN_AUDIT_ENABLED:/gm)].length, 1,
    "Do not move/duplicate the audit flag into job/global/client environments");
  assert.match(server, /nohup npm start -- -H 127\.0\.0\.1 /);
  assert.match(server, /set -euo pipefail/);
}

function requireDisposableJob(source) {
  const jobEnv = source.match(/^    env:\n([\s\S]*?)^    services:/m)?.[1];
  assert.ok(jobEnv, "Missing explicit disposable job environment");
  for (const entry of [
    'CI: "true"', 'DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/app_db',
    'APP_BASE_URL: http://127.0.0.1:3000', 'SECURITY_SMOKE_URL: http://127.0.0.1:3000',
    'PAYMONGO_DISBURSEMENTS_ENABLED: "false"', 'XENDIT_PAYOUTS_ENABLED: "false"',
    'PAYROLL_UNDERPAYMENT_POSTING_ENABLED: "false"', 'PAYMONGO_SECRET_KEY: ""',
    'XENDIT_SECRET_KEY: ""', 'REQUIRE_PRIVILEGED_MFA: "true"',
  ]) assert.ok(jobEnv.split("\n").includes("      " + entry), "Retain isolated safety setting: " + entry);
  assert.match(source, /^        image: postgres:16$/m);
  assert.match(source, /^          POSTGRES_DB: app_db$/m);
  assert.match(source, /^          - 5432:5432$/m);
}

test("salary-correction HTTP server enables the login-audit receipt prerequisite only in CI", () => {
  requireServerAudit(workflow);
  requireDisposableJob(workflow);
});

for (const value of [null, '"false"', '"TRUE"', '""', "true", '${{ vars.LOCAL_LOGIN_AUDIT_ENABLED }}']) {
  test("reject missing or nonliteral server audit flag: " + String(value), () => {
    const replacement = value === null ? "" : "          LOCAL_LOGIN_AUDIT_ENABLED: " + value + "\n";
    const broken = workflow.replace(flagLine, replacement);
    assert.notEqual(broken, workflow);
    assert.throws(() => requireServerAudit(broken), /Enable exact LOCAL_LOGIN_AUDIT_ENABLED/);
  });
}

test("setting the flag only on the HTTP client cannot satisfy the server prerequisite", () => {
  const broken = workflow.replace(flagLine, "").replace(
    '          TENANT_SECOND_PASS_MODE: isolated-ci-only\n',
    flagLine + '          TENANT_SECOND_PASS_MODE: isolated-ci-only\n');
  assert.notEqual(broken, workflow);
  assert.throws(() => requireServerAudit(broken), /Enable exact LOCAL_LOGIN_AUDIT_ENABLED/);
});

test("audit activation is not promoted to a workflow/job-wide setting", () => {
  const broken = workflow.replace('      CI: "true"\n', '      CI: "true"\n      LOCAL_LOGIN_AUDIT_ENABLED: "true"\n');
  assert.notEqual(broken, workflow);
  assert.throws(() => requireServerAudit(broken), /Do not move\/duplicate/);
});

test("a remote database or enabled payouts cannot pass this CI contract", () => {
  for (const [before, after] of [
    ["postgres@127.0.0.1:5432/app_db", "postgres@not-local.invalid:5432/app_db"],
    ['PAYMONGO_DISBURSEMENTS_ENABLED: "false"', 'PAYMONGO_DISBURSEMENTS_ENABLED: "true"'],
    ['XENDIT_PAYOUTS_ENABLED: "false"', 'XENDIT_PAYOUTS_ENABLED: "true"'],
  ]) {
    const broken = workflow.replace(before, after);
    assert.notEqual(broken, workflow);
    assert.throws(() => requireDisposableJob(broken), /Retain isolated safety setting/);
  }
});

test("the wiring guard runs before build; existing PostgreSQL and real HTTP cases stay mandatory", () => {
  const guard = workflow.indexOf("        run: " + guardRun);
  assert.ok(guard >= 0 && guard < workflow.indexOf("      - run: npm run build"));
  assert.match(workflow, /npx tsx --test tests\/hcm-salary-correction-cases-postgres\.test\.ts/);
  const probe = step(workflow, probeName);
  assert.match(probe, /^          TENANT_SECOND_PASS_MODE: isolated-ci-only$/m);
  assert.match(probe, /^          TENANT_641_SALARY_CORRECTION_CASE_PROOF: isolated-ci-only$/m);
  assert.match(probe, /^        run: npx tsx scripts\/qa\/tenant-second-pass-http\.mjs$/m);
  assert.doesNotMatch(probe, /continue-on-error|\|\|\s*true|^        if:/m);
});
