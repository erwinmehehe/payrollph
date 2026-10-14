import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const path = "qa-artifacts/governed-hire-853-report.json";
const required = process.env.NINE_STAGE_GOVERNED_HIRE_REQUIRED === "true";

test("governed Hire sidecar source has a strict nonproduction and no-money contract", () => {
  const source = readFileSync("scripts/qa/governed-hire-853-bridge.ts", "utf8");
  for (const phrase of [
    'assert.equal(process.env.GITHUB_ACTIONS, "true")',
    'assert.equal(dbUrl.hostname, "127.0.0.1")',
    'assert.equal(dbUrl.pathname, "/app_db")',
    '"HCM_GOVERNED_HIRE_REQUIRED"',
    '"recruitment/hire"',
    'processId',
    'deniedMaker',
    'deniedForeign',
    'releasedEntriesAfter',
    'assert.deepEqual(releasedEntriesAfter, releasedEntriesBefore',
  ]) {
    assert.ok(source.includes(phrase), "Missing guarded governed-Hire contract: " + phrase);
  }
  assert.doesNotMatch(source,
    /PAYMONGO_DISBURSEMENTS_ENABLED:\s*"true"|XENDIT_PAYOUTS_ENABLED:\s*"true"/);
});

test("governed Hire evidence is separate, synthetic and never a human pilot signoff",
  { skip: !required && !existsSync(path) }, () => {
    assert.ok(existsSync(path), "Governed Hire sidecar must execute before report acceptance");
    const report = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.scope, "isolated-fictional-hire-sidecar-not-the-connected-payroll-worker");
    assert.equal(report.independentHumanUat, "NOT_RUN");
    assert.equal(report.externalEmployerPilot, "NO_GO");
    assert.equal(report.payoutOrAgencySubmission, "PROHIBITED");
    assert.ok(Array.isArray(report.steps));
    assert.ok(Array.isArray(report.checks));
    if (report.status === "PASS") {
      assert.equal(report.steps.length, 4);
      assert.equal(report.checks.length, 4);
      assert.ok(report.checks.some(item => item.includes("Maker denied")));
      assert.ok(report.checks.some(item => item.includes("original released payroll")));
    }
    if (required) {
      assert.equal(report.sourceSha, process.env.PR_HEAD_SHA,
        "The sidecar must describe the exact reviewed commit");
      assert.equal(report.status, "PASS",
        "The governed Hire bridge is incomplete or failed; never claim acceptance");
    }
  });
