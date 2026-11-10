import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  REQUIRED_ENV, FORBIDDEN_ENV, SOURCE_BLOBS, requireDisposableResolutionEnv,
  verifyResolutionSources, gitBlobSha, assertDenied, assertUnchanged,
  assertAuditRollback, assertHigherVictim, assertOwnedTransition,
} from "../scripts/qa/tenant-studio-resolution-contract.mjs";

const copy = value => JSON.parse(JSON.stringify(value));
const stamp = "2026-10-15T01:00:00.000Z";
const note = "Fictional reviewed source-resolution evidence.";
const actor = { marker: "OWN_PRIVATE", org: { id: 1 }, owner: { id: 2, name: "Fictional owner" }, case: { id: 3 } };
const other = { marker: "VICTIM_PRIVATE" };
function fixture(transition = "resolve") {
  const row = {
    id: 3, organizationId: 1, caseType: "attendance_resolution", sourceType: "attendance_exception",
    sourceId: 4, executionId: null, stepIndex: null, title: "OWN_PRIVATE attendance case",
    employeeId: 5, status: "acknowledged", updatedAt: stamp,
    acknowledgedByUserId: 2, acknowledgedByName: actor.owner.name, acknowledgedAt: stamp,
    resolvedByUserId: null, resolvedByName: null, resolvedAt: null, resolutionNote: null,
  };
  if (transition === "reopen") Object.assign(row, {
    status: "resolved", resolvedByUserId: 2, resolvedByName: actor.owner.name, resolvedAt: stamp, resolutionNote: note,
  });
  const before = { automationOperationalCases: [row, { id: 99, organizationId: 9, status: "acknowledged" }],
    auditEvents: [{ id: 1, organizationId: 9, metadata: { frozen: true } }],
    attendanceExceptionEvents: [{ id: 4, organizationId: 1, status: "resolved" }],
    payrollRuns: [{ id: 5, organizationId: 9, status: "Draft" }], outbox: [] };
  const after = copy(before), changed = after.automationOperationalCases[0];
  if (transition === "resolve") Object.assign(changed, {
    status: "resolved", resolvedByUserId: 2, resolvedByName: actor.owner.name, resolvedAt: stamp, resolutionNote: note,
  });
  else Object.assign(changed, {
    status: "open", acknowledgedByUserId: null, acknowledgedByName: null, acknowledgedAt: null,
    resolvedByUserId: null, resolvedByName: null, resolvedAt: null, resolutionNote: null,
  });
  after.auditEvents.push({ id: 2, organizationId: 1, actor: actor.owner.name,
    action: "Automation operations case " + transition, resource: changed.title,
    metadata: { caseId: 3, caseType: row.caseType, sourceType: row.sourceType, sourceId: 4,
      executionId: null, stepIndex: null, note, sourceMutation: false, underlyingExecutionStatusUnchanged: true } });
  const json = { operationalCase: copy(changed), sourceMutation: false, executionStatusUnchanged: true };
  return { before, after, response: { status: 200, json, text: JSON.stringify(json) } };
}
const check = (f, transition = "resolve") => assertOwnedTransition(f.response, f.before, f.after, actor, transition, note, [other]);
const syncResponse = f => {
  f.response.json.operationalCase = copy(f.after.automationOperationalCases[0]);
  f.response.text = JSON.stringify(f.response.json);
};

test("environment refuses every missing/altered interlock and every external credential", () => {
  assert.equal(requireDisposableResolutionEnv({ ...REQUIRED_ENV }), true);
  for (const key of Object.keys(REQUIRED_ENV)) {
    const missing = { ...REQUIRED_ENV }; delete missing[key];
    assert.throws(() => requireDisposableResolutionEnv(missing), /STUDIO_RESOLUTION_REFUSED/);
    assert.throws(() => requireDisposableResolutionEnv({ ...REQUIRED_ENV, [key]: "wrong" }), /STUDIO_RESOLUTION_REFUSED/);
  }
  for (const key of FORBIDDEN_ENV)
    assert.throws(() => requireDisposableResolutionEnv({ ...REQUIRED_ENV, [key]: "fictional-rejected-secret" }), /STUDIO_RESOLUTION_REFUSED/);
});
test("pinned source verification rejects changed bytes and missing files", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-resolution-"));
  try {
    assert.throws(() => verifyResolutionSources(root));
    for (const file of Object.keys(SOURCE_BLOBS)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "changed unreviewed source\n");
    }
    assert.throws(() => verifyResolutionSources(root), /re-review changed source/);
    assert.equal(gitBlobSha("test content\n"), "d670460b4b4aece5915caf5c68d12f560a9fe3e4");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const transition of ["resolve", "reopen"]) {
  test(transition + " requires matching HTTP/SQL, exact state fields and one own audit", () => check(fixture(transition), transition));
}
test("reject empty HTTP success or a borrowed/foreign case", () => {
  for (const change of [f => { f.response.json = {}; }, f => { f.response.json.operationalCase.organizationId = 9; },
    f => { f.response.status = 204; }, f => { f.after.automationOperationalCases[0].id = 100; }]) {
    const f = fixture(); change(f); assert.throws(() => check(f));
  }
});
test("reject wrong resolver, evidence note, timestamp or unchanged state", () => {
  for (const [field, value] of [["resolvedByUserId", 9], ["resolvedByName", "other"],
    ["resolutionNote", "wrong"], ["resolvedAt", null], ["updatedAt", "bad"], ["status", "acknowledged"]]) {
    const f = fixture(); f.after.automationOperationalCases[0][field] = value; syncResponse(f);
    assert.throws(() => check(f));
  }
});
test("reopen must clear all previous acknowledgement and resolution fields", () => {
  for (const field of ["acknowledgedByUserId", "acknowledgedByName", "acknowledgedAt",
    "resolvedByUserId", "resolvedByName", "resolvedAt", "resolutionNote"]) {
    const f = fixture("reopen"); f.after.automationOperationalCases[0][field] = f.before.automationOperationalCases[0][field];
    syncResponse(f); assert.throws(() => check(f, "reopen"));
  }
});
test("reject collateral case/source/payroll/outbox changes", () => {
  for (const change of [
    f => { f.after.automationOperationalCases[1].status = "resolved"; },
    f => { f.after.automationOperationalCases[0].sourceId = 99; syncResponse(f); },
    f => { f.after.attendanceExceptionEvents[0].status = "open"; },
    f => { f.after.payrollRuns[0].status = "Released"; },
    f => { f.after.outbox.push({ id: 1 }); },
    f => { delete f.after.payrollRuns; },
  ]) { const f = fixture(); change(f); assert.throws(() => check(f)); }
});
test("reject missing/duplicate audit, foreign audit, or changed history/metadata", () => {
  for (const change of [
    f => { f.after.auditEvents.pop(); }, f => { f.after.auditEvents.push(copy(f.after.auditEvents.at(-1))); },
    f => { f.after.auditEvents.at(-1).organizationId = 9; },
    f => { f.after.auditEvents[0].metadata.frozen = false; },
    f => { f.after.auditEvents.at(-1).metadata.sourceMutation = true; },
    f => { f.after.auditEvents.at(-1).metadata.caseId = 99; },
  ]) { const f = fixture(); change(f); assert.throws(() => check(f)); }
});
test("reject private-marker disclosure including escaped unicode", () => {
  const f = fixture(); f.response.text += "VICTIM_PRIVATE";
  assert.throws(() => check(f), /private marker/);
  assert.throws(() => assertDenied({ status: 404, json: {}, text: "\\u0056ICTIM_PRIVATE" }, 404, [other], "denied"), /private marker/);
});
test("denial requires exact status, absent case and unchanged SQL", () => {
  const denied = { status: 404, json: { error: "Not found" }, text: '{"error":"Not found"}' };
  assert.doesNotThrow(() => assertDenied(denied, 404, [other], "denied"));
  assert.throws(() => assertDenied({ ...denied, status: 200 }, 404, [other], "denied"));
  assert.throws(() => assertDenied({ ...denied, json: { operationalCase: {} } }, 404, [other], "denied"));
  assert.throws(() => assertUnchanged({ cases: [1] }, { cases: [] }, "denied"));
});
test("audit-failure proof rejects an unreached veto and partial commit", () => {
  const before = { cases: [{ status: "acknowledged" }], audits: [] };
  assert.doesNotThrow(() => assertAuditRollback(before, copy(before), 0, 1));
  assert.throws(() => assertAuditRollback(before, copy(before), 0, 0), /actually be reached/);
  assert.throws(() => assertAuditRollback(before, copy(before), 0, 2), /actually be reached/);
  assert.throws(() => assertAuditRollback(before, { cases: [{ status: "resolved" }], audits: [] }, 0, 1));
});
test("victim IDs must be real higher business IDs above six, not merely third", () => {
  const make = id => Object.fromEntries(["org", "owner", "entity", "unit", "worker", "membership", "profile", "source", "case", "payroll"].map(key => [key, { id }]));
  assert.doesNotThrow(() => assertHigherVictim([make(1), make(2)], make(10)));
  assert.throws(() => assertHigherVictim([make(1), make(2)], make(3)));
  const bad = make(10); bad.source.id = 2;
  assert.throws(() => assertHigherVictim([make(1), make(2)], bad));
});
test("runner cannot skip safety, real HTTP, either transition, rollback reach or immutable snapshots", () => {
  const runner = readFileSync("scripts/qa/tenant-studio-resolution-http.mjs", "utf8");
  const guard = runner.indexOf("requireDisposableResolutionEnv();"), source = runner.indexOf("verifyResolutionSources();");
  const dbImport = runner.indexOf('import("../../src/db/index.ts")');
  assert.ok(guard >= 0 && source > guard && dbImport > source);
  for (const part of [
    'const a = await seed("RSVA"), b = await seed("RSVB")', "index < 7", 'await seed("RSVV", true)',
    "assertHigherVictim([a, b], victim)", 'for (const transition of ["resolve", "reopen"])',
    'await deny(actor, "resolve", {}, 409, "underlying source still open")',
    "[victim.source.id, ABSENT_ID]", "CREATE TRIGGER zz_qa_studio_resolution_veto", "PERFORM nextval(",
    'await veto(actor, "resolve")', 'await veto(actor, "reopen")',
    'await success(actor, "resolve")', 'await success(actor, "reopen")',
    "assertAuditRollback(before, await snapshot(), priorHits, await hits())", "assertSignedIn(a)",
    "assert.equal(ownSuccess, 4)", "assert.equal(negativeChecks, 56)", "assert.equal(auditRollbacks, 4)",
    "if (cleanupAuthorized)", "wholeMethodCredits: 0", "productionCertified: false",
  ]) assert.ok(runner.includes(part), "missing executed proof guard: " + part);
  assert.doesNotMatch(runner, /action:\s*["'](?:retry-execution-step|replay-execution|publish-rule|set-active)["']/);
});
test("dedicated workflow pins head, preflights before DB, runs HTTP and requires a receipt", () => {
  const workflow = readFileSync(".github/workflows/tenant-studio-resolution-qa.yml", "utf8");
  for (const part of ["image: postgres:16", "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
    "--check-env --check-sources", "npm ci --include=dev", "npm run db:push",
    "node scripts/qa/apply-isolated-baseline.mjs", "npm run build",
    "node --import tsx scripts/qa/tenant-studio-resolution-http.mjs",
    "if-no-files-found: error", "qa-artifacts/tenant-studio-resolution-receipt.json"])
    assert.ok(workflow.includes(part), "missing workflow gate: " + part);
  assert.ok(workflow.indexOf("--check-env --check-sources") < workflow.indexOf("npm run db:push"));
  assert.doesNotMatch(workflow, /continue-on-error|secrets\./);
});
