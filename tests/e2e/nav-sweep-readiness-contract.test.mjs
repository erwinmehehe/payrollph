import assert from "node:assert/strict";
import test from "node:test";
import { checkReadinessNavigationContract as check } from "./nav-sweep-readiness-contract.mjs";

const employerId = 19;
const endpoint = "http://127.0.0.1:3000/api/readiness/workspace?organizationId=19";
const blocked = {
  organizationId: employerId, status: "not-launch-ready",
  manualLaunch: { ready: false, summary: "A controlled payroll pilot has not been verified or approved." },
  launchBlockersRemaining: 1, scaleGapsRemaining: 1,
  evidence: { scope: "employer-only", employeeRecords: 2, payrollRunRecords: 0,
    employeesWithoutRestDay: 1 },
  gates: [
    { key: "employer-roster-observed", blocks: "launch", ready: true },
    { key: "external-pilot-acceptance", blocks: "launch", ready: false },
    { key: "operational-scale-evidence", blocks: "scale", ready: false },
  ],
};
const owned = (body = blocked) => ({
  employerId, responses: [{ status: 200, url: endpoint,
    cacheControl: "private, no-store", body }],
  pageText: "ROLLOUT READINESS Not launch-ready yet. MANUAL PILOT Blocked",
  alerts: [],
});

test("an employer-scoped 200 passes only while launch and pilot stay blocked", () => {
  assert.deepEqual(check(owned()), { ok: true, mode: "owned-not-launch-ready" });
  for (const body of [
    { ...blocked, organizationId: 20 },
    { ...blocked, status: "launch-ready" },
    { ...blocked, manualLaunch: { ready: true, summary: "Approved" } },
    { ...blocked, launchBlockersRemaining: 0 },
    { ...blocked, gates: blocked.gates.filter(g => g.key !== "external-pilot-acceptance") },
    { ...blocked, evidence: { ...blocked.evidence, scope: "platform" } },
  ]) assert.equal(check(owned(body)).ok, false, "fabricated launch/foreign status must fail");
  assert.equal(check({ ...owned(), responses: [] }).ok, false, "missing API request must fail");
  assert.equal(check({ ...owned(), responses: [{ ...owned().responses[0],
    url: endpoint + "&organizationId=20" }] }).ok, false, "duplicate selector must fail");
  assert.equal(check({ ...owned(), pageText: "Launch-ready. Pilot Ready" }).ok, false,
    "green presentation cannot borrow blocked API data");
  assert.equal(check({ ...owned(), responses: [{ ...owned().responses[0],
    cacheControl: "public, max-age=600" }] }).ok, false, "cached readiness must fail");
});

test("a genuine HTTP 503 requires explicit no-launch-evidence fallback", () => {
  const outage = {
    employerId, responses: [{ status: 503, url: endpoint,
      cacheControl: "no-store",
      body: { code: "WORKSPACE_READINESS_UNAVAILABLE",
        error: "Employer readiness evidence is unavailable. No launch or pilot status has been verified." } }],
    pageText: "Workspace readiness unavailable. No launch or pilot status has been verified.",
    alerts: ["Workspace readiness unavailable. Employer readiness evidence is unavailable."],
  };
  assert.deepEqual(check(outage), { ok: true, mode: "evidence-unavailable" });
  assert.equal(check({ ...outage, alerts: [] }).ok, false);
  assert.equal(check({ ...outage, responses: [{ ...outage.responses[0],
    body: { error: "Ready to launch" } }] }).ok, false);
  assert.equal(check({ ...outage, pageText: "Launch-ready." }).ok, false);
});
