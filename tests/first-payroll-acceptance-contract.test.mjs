import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("#993 PG18 parity runs against a verified empty disposable backend with no payout paths",()=>{
  const yml=readFileSync(".github/workflows/issue-993-pg18-preview-parity.yml","utf8");
  assert.match(yml,/image: postgres:18/);
  assert.match(yml,/FRESH_PG18_DEV_REHEARSAL: disposable-ci-only/);
  assert.match(yml,/NINE_STAGE_PG_MAJOR: "18"/);
  assert.match(yml,/HRIS_JOURNEY_ACCEPTANCE_MODE: synthetic-postgres-only/);
  assert.match(yml,/DATABASE_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/app_db/);
  assert.match(yml,/PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(yml,/XENDIT_PAYOUTS_ENABLED: "false"/);
  assert.match(yml,/XENDIT_PAYOUTS_LIVE_APPROVED: "false"/);
  assert.match(yml,/FINAL_PAY_MANUAL_RELEASE_ENABLED: "false"/);
  assert.match(yml,/WFM_GEOFENCE_PILOT_ENABLED: "false"/);
  assert.match(yml,/WFM_PUNCH_EVIDENCE_ENABLED: "false"/);
  assert.match(yml,/fresh-pg18-development-schema\.mjs preflight/);
  assert.match(yml,/verified-pg18-bootstrap\.mjs/);
  assert.match(yml,/fresh-pg18-development-schema\.mjs capture/);
  assert.match(yml,/apply-audit-0109-isolated\.mjs/);
  assert.match(yml,/tests\/first-payroll-tenant-resume-postgres\.test\.ts/);
  assert.match(yml,/humanUat:"NOT_RUN"/);
  assert.match(yml,/realEmployerPayroll:"NOT_RUN"/);
  assert.doesNotMatch(yml,/\b(?:NEON_DATABASE_URL|VERCEL_TOKEN|production-db)\b/);
});

test("#993 canonical preview uses real signed-in HTTP denial and no-store across roles",()=>{
  const js=readFileSync("scripts/first-payroll-zero-tenant-browser.mjs","utf8");
  assert.match(js,/sessionOwner, "first-payroll-gamma-owner@example\.test"/);
  assert.match(js,/expectPreviewDenied\(1, "owner: foreign-tenant canonical preview"\)/);
  assert.match(js,/expectPreviewDenied\(fixture\.organizationId, "HR: same-tenant payroll preview role"\)/);
  assert.match(js,/evidence\.status, 403/);
  assert.match(js,/evidence\.cache, "private, no-store"/);
  assert.match(js,/evidence\.keys, \["error"\]/);
  assert.match(js,/previewResponse\.headers\(\)\["cache-control"\]/);
  const workflow=readFileSync(".github/workflows/hris-journey-browser-qa.yml","utf8");
  const push=workflow.indexOf("  push:");
  const pull=workflow.indexOf("  pull_request:");
  const dispatch=workflow.indexOf("  workflow_dispatch:");
  assert.ok(push>=0&&pull>push&&dispatch>pull);
  for(const event of [workflow.slice(push,pull),workflow.slice(pull,dispatch)]){
    assert.ok(event.includes('- "scripts/first-payroll-zero-tenant-browser.mjs"'),
      "Changed authenticated API contract must trigger PG16 browser acceptance");
  }
});
