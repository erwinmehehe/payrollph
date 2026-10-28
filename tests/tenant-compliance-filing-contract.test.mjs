import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FILING_METHOD, FILING_PERIOD, requireDisposableFilingEnvironment,
  filingRejectionBody, proveOwnRejectedFiling,
  proveFilingDenied, proveFilingStateUntouched,
} from "../scripts/qa/tenant-compliance-filing-contract.mjs";
import { createRows } from "../scripts/qa/tenant-table-rows/write/compliance-filing.mjs";
import { validateTenantPathBinding } from "../scripts/qa/tenant-table-path.mjs";

const first = {
  marker: "TTBL-ATTA-fake", orgId: 11, entityId: 21, rank: 1,
  seeded: { id: 61, runId: 51 },
  owner: { name: "TTBL-ATTA-fake owner" },
  victim: { marker: "TTBL-VICTIM-fake", org: { id: 14 } },
};
const second = {
  marker: "TTBL-ATTB-fake", orgId: 12, entityId: 22, rank: 2,
  seeded: { id: 62, runId: 52 },
  owner: { name: "TTBL-ATTB-fake owner" },
  victim: first.victim,
};

function sample(subject = first) {
  const filing = {
    id: subject.seeded.id, organizationId: subject.orgId,
    legalEntityId: subject.entityId, payrollRunId: subject.seeded.runId,
    agency: "SSS", form: "R-3",
    periodLabel: subject.marker + " fictional SSS R-3 source",
    applicableMonth: FILING_PERIOD.applicableMonth,
    employeeCount: 1, fileName: subject.marker + "-synthetic-sss-r3.csv",
    fileSha256: subject.rank.toString(16).repeat(64),
    generatorVersion: "sss-r3-worksheet-v2",
    status: "generated", generatedBy: "Fictional",
    submissionMethod: null, agencyReference: null,
    submittedAt: null, outcomeNote: null, recordedBy: null, recordedAt: null,
  };
  const before = {
    filings: [filing], runs: [{
      id: subject.seeded.runId, organizationId: subject.orgId, status: "Released",
    }],
    employees: [{ id: subject.seeded.runId, organizationId: subject.orgId }],
    payProfiles: [{ id: subject.seeded.runId, organizationId: subject.orgId }],
    audit: [{ id: 70, organizationId: subject.orgId, action: "existing" }],
  };
  const accepted = {
    ...filing, status: "rejected", submissionMethod: "manual_entry",
    outcomeNote: filingRejectionBody(subject).note,
    recordedBy: subject.owner.name, recordedAt: "2026-10-28T00:00:00.000Z",
  };
  const after = structuredClone(before);
  after.filings[0] = accepted;
  after.audit.push({
    id: 71, organizationId: subject.orgId, actor: subject.owner.name,
    action: "SSS R-3 filing rejected", resource: accepted.periodLabel,
    metadata: {
      recordId: accepted.id, runId: accepted.payrollRunId,
      fileSha256: accepted.fileSha256, submissionMethod: "manual_entry",
      agencyReference: null, submittedAt: null,
    },
  });
  const json = { record: accepted };
  const response = { status: 200, json, text: JSON.stringify(json) };
  return { before, after, response };
}

test("only GitHub Actions / isolated PG16 localhost / no provider secrets may run proof", () => {
  const safe = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "https://payroll.example.test",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
    PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
    PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "", RESEND_API_KEY: "",
    XENDIT_PAYOUT_SECRET_KEY: "", POSTMARK_SERVER_TOKEN: "", SMTP_URL: "",
    STRIPE_SECRET_KEY: "",
  };
  requireDisposableFilingEnvironment(safe);
  const providerSecrets = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "STRIPE_SECRET_KEY",
  ];
  const required = Object.keys(safe).filter(n => !providerSecrets.includes(n));
  for (const name of required) {
    assert.throws(() => requireDisposableFilingEnvironment({
      ...safe, [name]: "other",
    }), /COMPLIANCE_FILING_REFUSED/, name);
    assert.throws(() => requireDisposableFilingEnvironment({
      ...safe, [name]: undefined,
    }), /COMPLIANCE_FILING_REFUSED/, name);
  }
  for (const name of providerSecrets) {
    assert.throws(() => requireDisposableFilingEnvironment({
      ...safe, [name]: "live-secret",
    }), /COMPLIANCE_FILING_REFUSED/, name);
  }
});

test("one exact path-bound GAP method, with genuine victim-path and own-org selectors", () => {
  const [row] = createRows({
    asc: x => x, auditBusinessSnapshot: x => x,
    auditEvents: {}, db: {}, employees: {}, eq: (a, b) => [a, b],
    employeePayProfiles: {}, governmentFilingValidations: {}, payrollRuns: {},
  });
  assert.equal(row.key, FILING_METHOD);
  assert.deepEqual(row.pathIds, { id: "id" });
  validateTenantPathBinding(row.key, row.pathIds);
  assert.equal(row.status ?? 200, 200);
  assert.equal(row.deny ?? 403, 403);
  assert.equal(row.forged.status, 404);
  for (const name of ["state", "seed", "ownBody", "foreignBody", "expect", "exercise"]) {
    assert.equal(typeof row[name], "function");
  }
  assert.deepEqual(row.ownBody(first), filingRejectionBody(first));
  assert.deepEqual(row.foreignBody(first), filingRejectionBody(first, 14));
  assert.equal(row.ownBody(first).organizationId, 11);
  assert.equal(row.foreignBody(first).organizationId, 14);
  assert.equal(row.forged.body(first).organizationId, 11);
  assert.ok(!row.ownBody(first).note.includes(first.victim.marker));

  // Shared write-table seeding happens before EVERY method's request. A
  // fictional Released run in the BIR worksheet's pay month changes its
  // monthly SHA, and a same-tax-year run can alter year-end export evidence.
  const legacy = readFileSync(
    "scripts/qa/tenant-table-rows/write/compliance-evidence.mjs", "utf8");
  const start = legacy.indexOf('key: "POST compliance/filing-validations"');
  const end = legacy.indexOf('key: "POST compliance/labor-inspection/drills"', start);
  assert.ok(start >= 0 && end > start, "shared BIR fixture must be grounded in source");
  const birPayDate = legacy.slice(start, end).match(/payDate:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})"/)?.[1];
  assert.ok(birPayDate, "shared BIR fixture must have an exact pay date");
  assert.equal(FILING_PERIOD.applicableMonth, FILING_PERIOD.payDate.slice(0, 7));
  assert.equal(FILING_PERIOD.periodEnd.slice(0, 7), FILING_PERIOD.applicableMonth);
  assert.notEqual(FILING_PERIOD.payDate.slice(0, 7), birPayDate.slice(0, 7),
    "SSS rejection fixture must not contaminate BIR 1601-C monthly SHA");
  assert.notEqual(FILING_PERIOD.payDate.slice(0, 4), birPayDate.slice(0, 4),
    "SSS rejection fixture must not contaminate BIR annual source evidence");
});

test("positive own filing decision checks genuine persisted ID, SHA, employer and exact audit", () => {
  const a = sample(first);
  const b = sample(second);
  proveOwnRejectedFiling(a.before, a.after, first, a.response);
  proveOwnRejectedFiling(b.before, b.after, second, b.response);
  assert.throws(() =>
    proveOwnRejectedFiling(a.before, a.after, second, a.response),
  "attacker A evidence cannot pass attacker B's proof");
  assert.throws(() =>
    proveOwnRejectedFiling(b.before, b.after, first, b.response),
  "attacker B evidence cannot pass attacker A's proof");
});

test("positive proof rejects forged, extra, or changed source, employer, payroll and response fields", () => {
  const mutate = [
    x => { x.response.status = 201; },
    x => { x.response.json = {}; },
    x => { x.after.filings.push({ id: 999 }); },
    x => { x.after.filings[0].id = 999; },
    x => { x.after.filings[0].organizationId = 14; },
    x => { x.after.filings[0].legalEntityId = 999; },
    x => { x.after.filings[0].payrollRunId = 999; },
    x => { x.after.filings[0].status = "accepted"; },
    x => { x.after.filings[0].fileSha256 = "0".repeat(64); },
    x => { x.after.filings[0].submissionMethod = "file_upload"; },
    x => { x.after.filings[0].agencyReference = "FAKE-RECEIPT"; },
    x => { x.after.filings[0].submittedAt = "2026-10-28T00:00:00.000Z"; },
    x => { x.after.filings[0].recordedAt = null; },
    x => { x.after.filings[0].outcomeNote = "Wrong employee"; },
    x => { x.after.filings[0].recordedBy = "Other company"; },
    x => { x.after.runs[0].status = "Draft"; },
    x => { x.after.employees[0].organizationId = 14; },
    x => { x.after.payProfiles[0].id = 999; },
    x => { x.after.audit.pop(); },
    x => { x.after.audit.at(-1).organizationId = 14; },
    x => { x.after.audit.at(-1).action = "Other action"; },
    x => { x.after.audit.at(-1).metadata.fileSha256 = "bad"; },
    x => { x.response.json.record.id = 999; },
    x => { x.response.text += first.victim.marker; },
  ];
  for (const change of mutate) {
    const fixture = structuredClone(sample(first));
    change(fixture);
    assert.throws(() => proveOwnRejectedFiling(
      fixture.before, fixture.after, first, fixture.response),
    "invalid forged evidence must be rejected");
  }
});

test("denials are bounded, correct status and contain no victim filing record", () => {
  for (const code of [400, 401, 403, 404, 409]) {
    const json = { error: "Filing unavailable." };
    proveFilingDenied({
      status: code, json, text: JSON.stringify(json),
    }, code, [first.marker, first.victim.marker]);
  }
  const altered = [
    x => { x.status = 200; },
    x => { x.json.record = { id: 61 }; },
    x => { x.json.error = first.victim.marker; x.text = JSON.stringify(x.json); },
    x => { x.text += first.marker; },
  ];
  for (const change of altered) {
    const x = { status: 404, json: { error: "Not found." },
      text: '{"error":"Not found."}' };
    change(x);
    assert.throws(() => proveFilingDenied(x, 404,
      [first.marker, first.victim.marker]));
  }
});

test("no denied or repeated outcome may mutate existing company, run, filing, worker or audit", () => {
  const x = sample(first).after;
  proveFilingStateUntouched(x, structuredClone(x));
  for (const name of Object.keys(x)) {
    const changed = structuredClone(x);
    changed[name][0].tampered = true;
    assert.throws(() => proveFilingStateUntouched(x, changed), name);
  }
});

test("source route first scopes real filing by organization and keeps independent MFA", () => {
  const route = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
  const store = readFileSync("src/lib/filing-evidence-store.ts", "utf8");
  for (const condition of [
    "enforceSameOriginMutation(request)",
    "getSessionUser()",
    "assertOrganizationRole(",
    "requireSensitiveActionMfa(user)",
    "getFilingValidation(organizationId, id)",
    "resolveMultiEntityContext(",
    "assertEntityResource(scope.context, existing.legalEntityId)",
    'existing.status !== "generated"',
    "assertOrganizationUnitAccess(",
    "recordFilingOutcome({ organizationId, id",
  ]) assert.ok(route.includes(condition), "missing actual route guard: " + condition);
  for (const condition of [
    "eq(governmentFilingValidations.id, id)",
    "eq(governmentFilingValidations.organizationId, organizationId)",
    'eq(governmentFilingValidations.status, "generated")',
    "outcome.outcome === \"accepted\"",
  ]) assert.ok(store.includes(condition), "missing actual DB tenant condition: " + condition);
});


test("filing outcome and audit share one PostgreSQL commit, including audit-veto rollback", () => {
  const route = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
  const store = readFileSync("src/lib/filing-evidence-store.ts", "utf8");
  const proof = readFileSync("scripts/qa/tenant-table-rows/write/compliance-filing.mjs", "utf8");

  assert.match(route, /record = await db\.transaction\(async \(tx\) => \{/);
  assert.match(route, /await recordFilingOutcome\(\{ organizationId, id, actor: user\.name, outcome: parsed\.value \}, tx\)/);
  assert.match(route, /if \(!updated\) return null;/);
  assert.match(route, /await tx\.insert\(auditEvents\)\.values\(\{/);
  assert.ok(route.indexOf("await tx.insert(auditEvents)") >
    route.indexOf("await recordFilingOutcome("), "audit write must follow the conditional filing outcome inside the same callback");
  assert.ok(!route.includes("await recordAuditEvent("),
    "independent audit connection cannot atomically roll back the filing decision");
  assert.match(store, /transaction\?: Parameters<Parameters<typeof db\.transaction>\[0\]>\[0\]/);
  assert.match(store, /await \(transaction \?\? db\)\s*\.update\(governmentFilingValidations\)/);
  assert.match(store, /eq\(governmentFilingValidations\.organizationId, input\.organizationId\)/);
  assert.match(store, /eq\(governmentFilingValidations\.status, "generated"\)/);

  // No mocked status proves rollback. The exact DDL runs inside isolated real
  // PostgreSQL 16 and must reject an actual HTTP PATCH audit INSERT.
  assert.match(proof, /CREATE FUNCTION ci_filing_audit_veto\(\) RETURNS trigger/);
  assert.equal((proof.match(/\$ci_filing_audit\$/g) ?? []).length, 2,
    "the CI-only PL/pgSQL function requires matching dollar quote delimiters");
  assert.match(proof, /CREATE TRIGGER ci_filing_audit_veto_trigger/);
  assert.match(proof, /RAISE EXCEPTION 'CI_ONLY_FILING_AUDIT_VETO'/);
  assert.match(proof, /atomic filing decision must roll back on a failed audit insert/);
  assert.match(proof, /proveFilingStateUntouched\(beforeVeto, await state\(ctx\.orgId\)\)/);
  assert.match(proof, /proveFilingStateUntouched\(victimBeforeVeto,/);
  assert.match(proof, /DROP TRIGGER ci_filing_audit_veto_trigger ON audit_events/);
  assert.match(proof, /DROP FUNCTION ci_filing_audit_veto\(\)/);
  assert.match(proof, /await db\.delete\(governmentFilingValidations\)\.where\(and\(/,
    "temporary audit-veto filing fixture must not contaminate later proofs");
  assert.match(proof, /atomicAuditInsertRollbackProven: true/);
});

test("manifest is still GAP; synthetic rejection is not external agency acceptance", () => {
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const record = Object.values(manifest.allApiRouteFiles)
    .find(row => row.route === "compliance/filing-validations/[id]");
  assert.equal(record?.methods?.find(method => method.name === "PATCH")?.status,
    "GAP", "pending proofs grant no coverage credits");
  assert.equal(FILING_METHOD, "PATCH compliance/filing-validations/[id]");
  assert.equal(filingRejectionBody(first).outcome, "rejected");
  assert.equal(filingRejectionBody(first).submissionMethod, "manual_entry");
  assert.equal(filingRejectionBody(first).agencyReference, undefined);
  const source = readFileSync(
    "scripts/qa/tenant-table-rows/write/compliance-filing.mjs", "utf8");
  assert.ok(source.includes('key: "PATCH compliance/filing-validations/[id]"'));
  assert.ok(source.includes("pathIds: { id: \"id\" }"));
  assert.ok(source.includes("ctx.victim.org.id"));
  assert.ok(source.includes("proveOwnRejectedFiling("));
  assert.ok(source.includes("proveFilingStateUntouched("));
  assert.ok(source.includes('outcome: "accepted"'));
});
