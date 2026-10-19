import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isVerifiedAttendanceCorrectionQueue,
  readVerifiedAttendanceCorrections,
  verifiedCorrectionReceipt,
} from "../src/lib/workforce-attendance-corrections-read";

const original = {
  workDate: "2026-10-18",
  timeIn: "2026-10-18T00:05:00.000Z",
  timeOut: "2026-10-18T09:00:00.000Z",
  breakStart: null,
  breakEnd: null,
  status: "Complete",
};
const correction = {
  id: 45, organizationId: 11, employeeId: 8, punchId: 72,
  workDate: "2026-10-18",
  originalPunchSnapshot: original,
  proposedPunchSnapshot: { ...original, timeIn: "2026-10-18T00:00:00.000Z" },
  reason: "Synthetic clock-in correction", status: "pending",
  requestedBy: "Synthetic HR Requester", requestedByUserId: 20,
  decidedBy: null, decisionNote: null, appliedAt: null,
  invalidatedPayrollRunIds: [],
} as const;
const valid = { organizationId: 11, requests: [correction] };
const fake = (payload: unknown, status = 200): typeof fetch =>
  (async () => Response.json(payload, { status })) as typeof fetch;

test("verified scoped queue and genuine empty queue pass", () => {
  assert.equal(isVerifiedAttendanceCorrectionQueue(valid, 11), true);
  assert.equal(isVerifiedAttendanceCorrectionQueue({ organizationId: 11, requests: [] }, 11), true);
  assert.equal(isVerifiedAttendanceCorrectionQueue(valid, 12), false);
  assert.equal(isVerifiedAttendanceCorrectionQueue({ organizationId: 11, requests: [{ ...correction, requestedByUserId: null }] }, 11), true,
    "Legacy unidentified maker is visible for controlled rejection, never approved");
});

test("incomplete, foreign or implausible 200 responses never render as empty approval queue", () => {
  const invalid: unknown[] = [
    {}, { organizationId: 11 }, { organizationId: 11, requests: null },
    { organizationId: 12, requests: [] },
    { ...valid, requests: [{ ...correction, organizationId: 12 }] },
    { ...valid, requests: [{ ...correction, employeeId: null }] },
    { ...valid, requests: [{ ...correction, punchId: "72" }] },
    { ...valid, requests: [{ ...correction, requestedByUserId: undefined }] },
    { ...valid, requests: [{ ...correction, requestedBy: "" }] },
    { ...valid, requests: [{ ...correction, status: "ready" }] },
    { ...valid, requests: [{ ...correction, workDate: "2026-02-30" }] },
    { ...valid, requests: [{ ...correction, originalPunchSnapshot: {} }] },
    { ...valid, requests: [{ ...correction, proposedPunchSnapshot: { ...original, timeIn: "not-time" } }] },
    { ...valid, requests: [{ ...correction, originalPunchSnapshot: { ...original, workDate: "2026-10-19" } }] },
    { ...valid, requests: [{ ...correction, invalidatedPayrollRunIds: null }] },
    { ...valid, requests: [{ ...correction, invalidatedPayrollRunIds: [7, 7] }] },
    { ...valid, requests: [{ ...correction, status: "approved", appliedAt: null }] },
    { ...valid, requests: [correction, correction] },
    { organizationId: 11, requests: Array.from({ length: 5001 }, (_, i) => ({ ...correction, id: i + 1 })) },
  ];
  for (const candidate of invalid) {
    assert.equal(isVerifiedAttendanceCorrectionQueue(candidate, 11), false,
      JSON.stringify(candidate).slice(0, 150));
  }
});

test("read helper rejects HTTP failures, fake 200 HTML, wrong employer, incomplete response", async () => {
  const history: Array<{ path: string; init?: RequestInit }> = [];
  const controller = new AbortController();
  const stub = (async (path: string | URL | Request, init?: RequestInit) => {
    history.push({ path: String(path), init });
    return Response.json(valid);
  }) as typeof fetch;
  assert.deepEqual(await readVerifiedAttendanceCorrections(11, stub, controller.signal), valid);
  assert.equal(history[0].path, "/api/workforce/attendance-corrections?organizationId=11");
  assert.equal(history[0].init?.cache, "no-store");
  assert.equal(history[0].init?.signal, controller.signal);
  await assert.rejects(() => readVerifiedAttendanceCorrections(0, stub), /valid employer/);
  assert.equal(history.length, 1, "No request for invalid employer");
  await assert.rejects(() => readVerifiedAttendanceCorrections(11, fake({}, 403)), /unavailable/);
  await assert.rejects(() => readVerifiedAttendanceCorrections(11, fake({}, 404)), /unavailable/);
  await assert.rejects(() => readVerifiedAttendanceCorrections(11, fake({ organizationId: 12, requests: [] })), /another employer/);
  await assert.rejects(() => readVerifiedAttendanceCorrections(11, fake({})), /incomplete/);
  const html = (async () => new Response("<html>Sign in</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(() => readVerifiedAttendanceCorrections(11, html), /unreadable/);
  assert.deepEqual(await readVerifiedAttendanceCorrections(11, fake({ organizationId: 11, requests: [] })),
    { organizationId: 11, requests: [] });
});

test("create and decide receipts match the actual employer and immutable source record", () => {
  const create = { correction };
  assert.equal(verifiedCorrectionReceipt(create, 11, "create_request", { punchId: 72 }), true);
  for (const candidate of [
    {}, { correction: { ...correction, id: "45" } },
    { correction: { ...correction, organizationId: 12 } },
    { correction: { ...correction, punchId: 73 } },
    { correction: { ...correction, requestedByUserId: null } },
    { correction: { ...correction, status: "approved" } },
  ]) {
    assert.equal(verifiedCorrectionReceipt(candidate, 11, "create_request", { punchId: 72 }), false);
  }
  const rejected = { correction: { ...correction, status: "rejected" } };
  const approved = { correction: { ...correction, status: "approved", appliedAt: "2026-10-19T00:00:00.000Z" } };
  assert.equal(verifiedCorrectionReceipt(rejected, 11, "decide_request", { requestId: 45, decision: "rejected" }), true);
  assert.equal(verifiedCorrectionReceipt(approved, 11, "decide_request", { requestId: 45, decision: "approved" }), true);
  for (const candidate of [
    { correction: { ...approved.correction, organizationId: 12 } },
    { correction: { ...approved.correction, id: 99 } },
    { correction: { ...approved.correction, employeeId: null } },
    { correction: { ...approved.correction, appliedAt: null } },
    { correction: { ...approved.correction, status: "pending" } },
  ]) assert.equal(verifiedCorrectionReceipt(candidate, 11, "decide_request", { requestId: 45, decision: "approved" }), false);
});

test("route and UI preserve source authorization, disabled controls, replay-safety and explicit Retry", () => {
  const route = readFileSync("src/app/api/workforce/attendance-corrections/route.ts", "utf8");
  const ui = readFileSync("src/components/workspace/attendance-corrections-panel.tsx", "utf8");
  assert.match(route, /organizationId,\n    requests: requests\.filter/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.match(route, /existing\.requestedByUserId === user\.id/);
  assert.match(route, /attendancePunchSnapshotsMatch\(original, current\)/);
  assert.match(route, /payrollIsImmutable\(run\.status\)/);
  assert.match(ui, /ScopedAttendanceCorrectionsPanel key=\{scope\}/);
  assert.match(ui, /loadControllerRef\.current\?\.abort\(\)/);
  assert.match(ui, /readVerifiedAttendanceCorrections\(organizationId, fetch, controller\.signal\)/);
  assert.match(ui, /const queueVerified = !loading && !readError/);
  assert.match(ui, /canManage && queueVerified &&/);
  assert.match(ui, /queueVerified && corrections\.length === 0/);
  assert.match(ui, /decision === "approved" && target\.requestedByUserId == null/);
  assert.match(ui, /verifiedCorrectionReceipt\(body, organizationId, "decide_request"/);
  assert.match(ui, /Retry attendance queue/);
  assert.doesNotMatch(ui, /Array\.isArray\(body\.requests\) \? body\.requests : \[\]/);
});
