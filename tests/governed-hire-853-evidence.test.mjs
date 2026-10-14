import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const path = "qa-artifacts/governed-hire-853-report.json";
const required = process.env.NINE_STAGE_GOVERNED_HIRE_REQUIRED === "true";

const { fixtureClockOffset } = createRequire(import.meta.url)("../scripts/qa/synthetic-session-clock.cjs");
const now = Date.parse("2026-10-14T08:00:00Z");
const safe = { CI:"true",GITHUB_ACTIONS:"true",QA_URL:"http://127.0.0.1:3000",
 APP_BASE_URL:"http://127.0.0.1:3000",DEMO_MODE:"false",
 DATABASE_URL:"postgresql://postgres:fictional@127.0.0.1:5432/app_db",
 NINE_STAGE_SYNTHETIC_CLOCK:"2026-10-31",NINE_STAGE_SYNTHETIC_REAL_ANCHOR:String(now),
 PAYMONGO_DISBURSEMENTS_ENABLED:"false",XENDIT_PAYOUTS_ENABLED:"false",
 XENDIT_PAYOUTS_LIVE_APPROVED:"false",WFM_PUNCH_EVIDENCE_ENABLED:"false",
 WFM_GEOFENCE_PILOT_ENABLED:"false",FINAL_PAY_MANUAL_RELEASE_ENABLED:"false" };
test("governed Hire fixture guard rejects remote, live-money and stale-clock targets", () => {
 assert.equal(fixtureClockOffset(safe,now),17*86400000);
 for (const patch of [{CI:"false"},{GITHUB_ACTIONS:"false"},{DEMO_MODE:"true"},
  {DATABASE_URL:"postgresql://postgres:fictional@remote.example:5432/app_db"},
  {DATABASE_URL:"postgresql://postgres:fictional@127.0.0.1:5432/production"},
  {DATABASE_URL:"postgresql://postgres:fictional@127.0.0.1:5432/app_db?host=remote.example"},
  {PAYMONGO_DISBURSEMENTS_ENABLED:"true"},{XENDIT_PAYOUTS_ENABLED:"true"},
  {PAYMONGO_SECRET_KEY:"fictional-key"},{OPENAI_API_KEY:"fictional-key"},
  {NINE_STAGE_SYNTHETIC_REAL_ANCHOR:String(now-31*60000)},
  {NINE_STAGE_SYNTHETIC_CLOCK:"2026-09-30"}]) {
   assert.throws(()=>fixtureClockOffset({...safe,...patch},now));
 }
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
