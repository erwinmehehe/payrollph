import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  requireDisposableSalaryPreview, proveOwnedSalaryPreview, sameEmployerSnapshotUnchanged,
} from "../scripts/qa/tenant-hcm-salary-correction-preview-http.mjs";

const env = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  MULTI_ENTITY_ENABLED: "true",
  HCM_SALARY_CORRECTION_PREVIEW_ENABLED: "true",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", DEMO_MODE: "false",
};

test("refuse live endpoints, missing CI, disabled feature and provider credentials", () => {
  assert.doesNotThrow(() => requireDisposableSalaryPreview(env));
  for (const [name, value] of Object.entries(env)) {
    assert.throws(() => requireDisposableSalaryPreview({...env, [name]: undefined}), name);
    assert.throws(() => requireDisposableSalaryPreview({
      ...env, [name]: value === "false" ? "true" : "false",
    }), name);
  }
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "POSTMARK_SERVER_TOKEN", "RESEND_API_KEY",
  ]) assert.throws(() => requireDisposableSalaryPreview({...env, [name]: "nonempty"}));
});

test("owned preview must use genuine employer and employee revision evidence", () => {
  const owner = {
    org: {id: 17}, entity: {id: 21}, worker: {id: 77},
    revision: {id: 49}, expectedDelta: "2000.00",
  };
  const response = {
    status: 200,
    json: {
      status: "assessment_only", tenantId: 17, subjectEmployeeId: 77,
      legalEntityId: 21, assessment: {
        evidence: "revision_as_of_date", rateDeltaPerBasisUnit: "2000.00",
        payrollAmountDelta: null,
      },
      recentRevisions: [{id: 49}],
      preview: {completePayableAmountKnown: false},
      notice: "Released payroll remains immutable.",
    },
    headers: {get: () => "private, no-store"},
    text: JSON.stringify({status: "assessment_only"}),
  };
  assert.doesNotThrow(() => proveOwnedSalaryPreview(response, owner));
  assert.throws(() => proveOwnedSalaryPreview({...response, status: 403}, owner));
  assert.throws(() => proveOwnedSalaryPreview({...response, json: {...response.json, recentRevisions: []}}, owner));
  assert.throws(() => proveOwnedSalaryPreview({...response, json: {...response.json, legalEntityId: 22}}, owner));
  assert.throws(() => proveOwnedSalaryPreview({...response, json: {...response.json, subjectEmployeeId: 78}}, owner));
  assert.throws(() => proveOwnedSalaryPreview({...response, json: {...response.json, assessment: {
    ...response.json.assessment, rateDeltaPerBasisUnit: null,
  }}}, owner));
  assert.throws(() => sameEmployerSnapshotUnchanged({pay:[1]}, {pay:[2]}, "foreign denial"));
});

test("real HTTP script includes nonempty owned evidence and a distinct higher-ID victim", () => {
  const runner = readFileSync("scripts/qa/tenant-hcm-salary-correction-preview-http.mjs", "utf8");
  for (const mandatory of [
    "requireDisposableSalaryPreview();",
    'import("../../src/db/index.ts")',
    '["ATTA", "ATTB", "VICTIM"]',
    "victim.worker.id > attacker.siblingWorker.id",
    "proveOwnedSalaryPreview(ownA, a)",
    "proveOwnedSalaryPreview(ownB, b)",
    "actor.siblingWorker.id, actor.siblingEntity.id",
    "bodyFor(victim)",
    '"x-legal-entity-id"',
    "duplicate query entity selectors",
    "db.delete(s.userLegalEntityGrants)",
    "revokedSameSessionDenied: true",
    'methodStatus: "GAP", newCoverageCredits: 0',
    "assert.deepEqual(await snapshots(), before",
  ]) assert.ok(runner.includes(mandatory), "missing mandatory real-HTTP proof: " + mandatory);
  assert.ok(runner.indexOf("requireDisposableSalaryPreview();") <
    runner.indexOf('import("../../src/db/index.ts")'));
});
