import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isVerifiedTalentComparison,
  isVerifiedTalentDirectory,
  readTalentComparison,
  readTalentDirectory,
} from "../src/lib/hcm-talent-continuity-read";
import {
  freezeTalentRoleSkills, compareInternalTalentEvidence,
} from "../src/lib/hcm-talent-continuity";

const organizationId = 33;
const employeeId = 17;
const requisitionId = 41;
const directory = () => ({
  organizationId,
  employees: [{ id: employeeId, label: "Fictional Employee" }],
  requisitions: [{ id: requisitionId, title: "Fictional Manager", roleCriteriaRecorded: true }],
  notice: "Private employer-scoped review evidence.",
});

const snapshot = freezeTalentRoleSkills({
  profile: { id: 70, title: "Fictional Manager", familyId: 5, levelId: 3, active: true },
  skills: [{ id: 81, code: "QA", name: "Fictional skill", active: true }],
  direct: [{ jobProfileId: 70, skillId: 81, minimumProficiency: 3, mandatory: true }],
  inherited: [],
  capturedAt: "2026-10-10T03:00:00.000Z",
});

const comparison = () => ({
  organizationId,
  employee: { id: employeeId, label: "Fictional Employee" },
  requisition: { id: requisitionId, title: "Fictional Manager", positionId: 90 },
  comparison: compareInternalTalentEvidence({
    snapshot, asOf: "2026-10-26",
    employeeSkills: [{
      skillId: 81, proficiency: 4, status: "verified" as const,
      effectiveFrom: "2026-01-01", effectiveUntil: null,
    }],
    completedReviews: [], developmentPlans: [],
  }),
});
const fake = (response: Response): typeof fetch =>
  (async () => response) as typeof fetch;

test("talent directory validates explicit selected employer and legitimate empty roster", async () => {
  assert.equal(isVerifiedTalentDirectory(directory(), organizationId), true);
  assert.deepEqual(await readTalentDirectory(organizationId, fake(Response.json(directory()))), {
    status: "ready", data: directory(),
  });
  const empty = { ...directory(), employees: [], requisitions: [] };
  assert.equal(isVerifiedTalentDirectory(empty, organizationId), true);
  assert.deepEqual(await readTalentDirectory(organizationId, fake(Response.json(empty))), {
    status: "ready", data: empty,
  });
});

test("missing/foreign/duplicate/invalid talent directories cannot appear as empty success", async () => {
  const cases: unknown[] = [
    {}, null, { employees: [], requisitions: [] },
    { ...directory(), organizationId: 34 },
    { ...directory(), employees: null },
    { ...directory(), requisitions: null },
    { ...directory(), employees: [{ id: employeeId, label: "" }] },
    { ...directory(), employees: [...directory().employees, ...directory().employees] },
    { ...directory(), requisitions: [{ id: requisitionId, title: "Fictional", roleCriteriaRecorded: "yes" }] },
    { ...directory(), requisitions: [...directory().requisitions, ...directory().requisitions] },
    { ...directory(), notice: null },
  ];
  for (const payload of cases) {
    assert.equal(isVerifiedTalentDirectory(payload, organizationId), false);
    await assert.rejects(readTalentDirectory(organizationId, fake(Response.json(payload))));
  }
  for (const status of [401, 404, 503]) {
    await assert.rejects(readTalentDirectory(organizationId,
      fake(Response.json({ error: "No access to private data." }, { status }))));
  }
  assert.deepEqual(await readTalentDirectory(organizationId,
    fake(Response.json({ error: "Forbidden" }, { status: 403 }))), { status: "forbidden" });
  await assert.rejects(readTalentDirectory(0, fake(Response.json(directory()))));
});

test("only verified comparison of the exact selected worker, role and employer displays evidence", async () => {
  const expected = comparison();
  assert.equal(isVerifiedTalentComparison(expected, organizationId, employeeId, requisitionId), true);
  assert.deepEqual(await readTalentComparison(organizationId, employeeId, requisitionId,
    fake(Response.json(expected))), { status: "ready", data: expected });
  assert.equal(expected.comparison.counts.verifiedMeeting, 1);
});

test("foreign, malformed, inconsistent and contradictory private comparison fails closed", async () => {
  const expected = comparison();
  const row = expected.comparison.rows[0];
  const invalid: unknown[] = [
    {}, null, { ...expected, organizationId: 34 },
    { ...expected, employee: { ...expected.employee, id: 18 } },
    { ...expected, requisition: { ...expected.requisition, id: 42 } },
    { ...expected, requisition: { ...expected.requisition, positionId: 0 } },
    { ...expected, comparison: null },
    { ...expected, comparison: { ...expected.comparison, rows: null } },
    { ...expected, comparison: { ...expected.comparison, counts: { ...expected.comparison.counts, total: 0 } } },
    { ...expected, comparison: { ...expected.comparison, counts: { ...expected.comparison.counts, verifiedMeeting: 0 } } },
    { ...expected, comparison: { ...expected.comparison, version: "unknown" } },
    { ...expected, comparison: { ...expected.comparison, target: { ...expected.comparison.target, fingerprint: "not-an-hash" } } },
    { ...expected, comparison: { ...expected.comparison, rows: [row, row] } },
    { ...expected, comparison: { ...expected.comparison, rows: [{ ...row, status: "verified_below" }] } },
    { ...expected, comparison: { ...expected.comparison, rows: [{ ...row, verifiedProficiency: null }] } },
    { ...expected, comparison: { ...expected.comparison, rows: [{ ...row, source: "unknown" }] } },
  ];
  for (const payload of invalid) {
    assert.equal(isVerifiedTalentComparison(payload, organizationId, employeeId, requisitionId), false);
    await assert.rejects(readTalentComparison(organizationId, employeeId, requisitionId,
      fake(Response.json(payload))));
  }
  for (const status of [401, 404, 409, 503]) {
    await assert.rejects(readTalentComparison(organizationId, employeeId, requisitionId,
      fake(Response.json({ error: "Cannot verify employee role." }, { status }))));
  }
  assert.deepEqual(await readTalentComparison(organizationId, employeeId, requisitionId,
    fake(Response.json({ error: "Forbidden" }, { status: 403 }))), { status: "forbidden" });
});

test("no-store and abort signals are forwarded to the authorized private GET", async () => {
  const controller = new AbortController();
  const requests: Array<{ path: string; options: RequestInit | undefined }> = [];
  const fetcher = (async (path: string | URL | Request, options?: RequestInit) => {
    requests.push({ path: String(path), options });
    return Response.json(requests.length === 1 ? directory() : comparison());
  }) as typeof fetch;
  await readTalentDirectory(organizationId, fetcher, controller.signal);
  await readTalentComparison(organizationId, employeeId, requisitionId, fetcher, controller.signal);
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(req.options?.cache, "no-store");
    assert.equal(req.options?.signal, controller.signal);
    assert.match(req.path, /organizationId=33/);
  }
  assert.match(requests[1].path, /employeeId=17/);
  assert.match(requests[1].path, /requisitionId=41/);
});

test("stale manager read actions are revoked before refresh and comparison responses are guarded", () => {
  const ui = readFileSync("src/components/talent-continuity-panel.tsx", "utf8");
  const api = readFileSync("src/app/api/performance/talent-continuity/route.ts", "utf8");
  assert.match(ui, /readTalentDirectory\(organizationId, fetch, controller\.signal\)/);
  assert.match(ui, /readTalentComparison\(/);
  assert.match(ui, /directoryController\.current\?\.abort\(\)/);
  assert.match(ui, /comparisonController\.current\?\.abort\(\)/);
  assert.match(ui, /directoryRevision\.current === revision/);
  assert.match(ui, /directoryRevision\.current === directoryAtStart/);
  assert.match(ui, /setDirectoryReady\(false\)/);
  assert.match(ui, /setEmployees\(\[\]\)/);
  assert.match(ui, /setRequisitions\(\[\]\)/);
  assert.match(ui, /setResult\(null\)/);
  assert.match(ui, /invalidateComparison\(\)/);
  assert.match(ui, /disabled=\{!directoryReady \|\| !employeeId \|\| !requisitionId/);
  assert.match(ui, /\{directoryReady && !loading && !requisitions\.length/);
  assert.doesNotMatch(ui, /setEmployees\(data\.employees \?\? \[\]\)/);
  assert.doesNotMatch(ui, /setResult\(data as EvidenceResponse\)/);
  assert.match(api, /return privateJson\(\{\s*organizationId,\s*employees:/);
  assert.match(api, /return privateJson\(\{\s*organizationId,\s*employee:/);
  assert.match(api, /PRIVATE_TALENT_ROLES/);
  assert.match(api, /assertScope\(access, employee\.orgUnitId\)/);
  assert.match(api, /assertScope\(access, position\.orgUnitId\)/);
});
