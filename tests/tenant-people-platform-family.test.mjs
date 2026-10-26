import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { createRows as people } from "../scripts/qa/tenant-table-rows/write/people.mjs";
import { createRows as platform } from "../scripts/qa/tenant-table-rows/write/platform.mjs";

const rows = [...people({ assert }), ...platform({ assert })];
const base = { orgId: 11, workerId: 21, unitId: 31, marker: "OWN-MARK", owner: { id: 91, name: "Own owner" },
  victim: { org: { id: 99 }, worker: { id: 199 }, unit: { id: 299 }, owner: { name: "Victim owner" } },
  victimSeeded: { id: 399, name: "Victim delegate", code: "victim-code", conditions: { version: 1, all: [{ field: "title", operator: "eq", value: "Fictional" }], any: [] } } };
const cases = [
  ["PATCH discipline", { employeeId: 21, offense: "OWN-MARK", employeeExplanation: "OWN-MARK written explanation", status: "explanation_submitted", explanationSubmittedAt: "2026-10-25T00:00:00Z" }, {}, "status", "nte_issued"],
  ["PATCH provisioning", { employeeId: 21, title: "OWN-MARK", done: true, completedBy: "Own owner", completedAt: "2026-10-25T00:00:00Z" }, {}, "done", false],
  ["POST dynamic-worker-groups", { name: "OWN-MARK revised", code: "own-code", conditions: { version: 1, all: [{ field: "title", operator: "eq", value: "Fictional" }], any: [] }, version: 2, active: false }, { version: 1, code: "own-code", conditions: { version: 1, all: [{ field: "title", operator: "eq", value: "Fictional" }], any: [] } }, "version", 1, "group"],
  ["POST recruitment", { requisitionId: 41, fullName: "OWN-MARK applicant", email: "own-mark@example.invalid", stage: "applied", notes: "OWN-MARK" }, {}, null],
  ["PATCH recruitment", { fullName: "OWN-MARK", requisitionId: 61, notes: "OWN-MARK revised notes", stage: "applied", hiredEmployeeId: null }, { requisitionId: 61 }, "notes", "old notes"],
  ["POST delegations", { fromApprover: "Own owner", toApprover: "Own delegate", reason: "OWN-MARK", startsOn: "2026-01-01", endsOn: "2026-12-31", active: true }, { name: "Own delegate" }, null],
  ["POST it-operations", { employeeId: 21, applicationId: 41, state: "grant_requested", requestedByUserId: 91, confirmedByUserId: null }, {}, null],
  ["PATCH it-operations", { employeeId: 21, applicationId: 61, state: "revoked", confirmedByUserId: 91 }, { applicationId: 61 }, "state", "revoke_requested"],
  ["POST workforce/worksites", { name: "OWN-MARK", code: "OWN-MARK", orgUnitId: 31, siteType: "office", timezone: "Asia/Manila", active: true }, {}, null, undefined, "worksite"],
  ["PATCH compliance/data-requests", { subjectEmail: "own-mark@example.invalid", requestType: "access", status: "in_progress", notes: "OWN-MARK triage", handledBy: "Own owner", completedAt: null }, {}, "status", "received"],
  ["POST approval-chains", { name: "OWN-MARK revised", code: "own-code", version: 2, active: false, steps: [{ approver: "Own owner" }] }, { version: 1, code: "own-code" }, "version", 1],
  ["POST integration-connectors", { name: "OWN-MARK", provider: "slack", active: false, credentialCiphertext: "fictional-opaque-value" }, { credentialCiphertext: "fictional-opaque-value" }, "active", true],
];

for (const [key, fields, seed, changedField, oldValue, envelope] of cases) {
  const spec = rows.find(r => r.key === key);
  test(key + " distinguishes genuine persisted own change from no-op/foreign/false response", () => {
    const c = { ...base, seeded: { id: 41, ...seed } };
    const value = { id: changedField ? 41 : 51, organizationId: 11, ...fields };
    const before = changedField ? [{ ...value, [changedField]: oldValue }] : [];
    const after = [value];
    const payload = { ...value }; if (key === "POST integration-connectors") { delete payload.credentialCiphertext; delete payload.organizationId; }
    const response = { json: envelope ? { [envelope]: payload } : payload };
    spec.expect(before, after, c, response);
    assert.throws(() => spec.expect(before, before, c, response));
    assert.throws(() => spec.expect(before, after, { ...c, orgId: 12 }, response));
    assert.throws(() => spec.expect(before, after.map(r => ({ ...r, organizationId: 99 })), c, response));
    const incorrect = { ...payload, id: 999 };
    assert.throws(() => spec.expect(before, after, c, { json: envelope ? { [envelope]: incorrect } : incorrect }));
    if (changedField) assert.throws(() => spec.expect(before, after, { ...c, seeded: { ...c.seeded, id: 12345 } }, response));
  });
  test(key + " sends a distinct real-victim selector with a valid action", () => {
    const c = { ...base, seeded: { id: 41, ...seed } };
    const own = spec.ownBody(c), foreign = spec.foreignBody(c);
    assert.notDeepEqual(own, foreign);
    if (Object.hasOwn(own, "organizationId")) { assert.equal(own.organizationId, 11); assert.equal(foreign.organizationId, 99); }
    else { const field = key === "PATCH recruitment" ? "applicantId" : "id"; assert.equal(own[field], 41); assert.equal(foreign[field], 399); }
    if (spec.forged) {
      const forged = spec.forged.body(c);
      assert.equal(forged.organizationId, 11); assert.notDeepEqual(forged, own);
      assert.ok([404, 422].includes(spec.forged.status));
    }
  });
}

test("executed People/platform credits stay pinned, selected refresh does not add coverage, and other GAPs remain", () => {
  const file = "scripts/qa/tenant-isolation-coverage-manifest.json", before = readFileSync(file, "utf8");
  const report = JSON.parse(execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--check", "--only-key", "PATCH discipline"], { encoding: "utf8" }));
  assert.equal(report.newlyCredited, 0);
  assert.deepEqual(report.before, report.after);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.throws(() => execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--check", "--only-key", "PATCH unknown"], { stdio: "pipe" }));
  assert.throws(() => execFileSync(process.execPath, ["scripts/qa/tenant-table-credit.mjs", "--check", "--only-key", "POST workforce/worksites"], { stdio: "pipe" }), "incomplete worksite POST cannot be explicitly credited");
  const manifest = JSON.parse(before);
  assertLiveTenantCounts(assert, manifest);
  const sharedLines = readFileSync("scripts/qa/tenant-write-table-http.mjs", "utf8").split("\n");
  const executionPin = fragment => {
    const matches = sharedLines.flatMap((line, index) => line.includes(fragment) ? [index + 1] : []);
    assert.equal(matches.length, 1, "each shared proof assertion has one exact execution site"); return matches[0];
  };
  for (const [key] of cases) {
    const [verb, route] = key.split(" ");
    const record = Object.values(manifest.allApiRouteFiles).find(r => r.route === route);
    const method = record.methods.find(m => m.name === verb);
    if (key === "POST workforce/worksites") {
      assert.equal(method.status, "GAP", "Only create_worksite is proven; other actions remain untested");
      assert.equal(method.testedBy, null, "Incomplete method evidence must not be source-pinned as covered");
      assert.match(method.reason, /create_worksite/);
      continue;
    }
    assert.equal(method.status, "COVERED", key);
    assert.equal(method.testedBy.file, "scripts/qa/tenant-write-table-http.mjs", key);
    assert.equal(method.testedBy.ownPositiveLine, executionPin('const owned = expectStatus(await request(urlFor("own"),'), key);
    assert.equal(method.testedBy.foreignDenialLine, executionPin('const foreign = expectStatus(await request(urlFor("foreign"),'), key);
    assert.equal(method.testedBy.unchangedDbLine, executionPin('assert.deepEqual(victimAfter, victimBefore,'), key);
    assert.match(method.testedBy.evidence, /run 40200060037 head 1fd16ee304a896072560fd86ff06915e7bce159c/, key);
    assert.ok(method.testedBy.rowFile.startsWith("scripts/qa/tenant-table-rows/write/"), key);
  }
  const pending = Object.values(manifest.allApiRouteFiles).find(r => r.route === "account/email").methods.find(m => m.name === "POST");
  assert.equal(pending.status, "GAP", "unrelated untested routes must remain GAP");
});

test("POST delegations seeds an MFA-ready fictional member for shared enterprise policy tests", async () => {
  const usersTable = Symbol("users"), membershipTable = Symbol("userOrganizations");
  const inserted = [];
  const db = { insert(table) { return { values(value) {
    inserted.push({ table, value });
    return { returning: async () => [{ id: 501, ...value }] };
  } }; } };
  const fixture = platform({ assert, db, users: usersTable, userOrganizations: membershipTable })
    .find(row => row.key === "POST delegations");
  const member = await fixture.seed({ org: { id: 11 }, marker: "OWN-MARK" });
  assert.deepEqual(inserted.map(row => row.table), [usersTable, membershipTable]);
  assert.equal(inserted[0].value.totpEnabled, true, "active fictional local-password members must be TOTP-ready");
  assert.equal(inserted[1].value.active, true);
  assert.equal(inserted[1].value.userId, member.id);
  assert.equal(inserted[1].value.organizationId, 11);
});
