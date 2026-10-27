import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readScopedResponse, scopedReadFailureForHttpStatus, scopedReadFailureMessage,
} from "../src/lib/hcm-scoped-read-failure";
import {
  validMyTeamResponse, validOrgExplorerResponse,
  validPositionHistoryResponse, validTeamLeaveResponse,
} from "../src/lib/hcm-scoped-read-validation";

const team = () => ({
  organizationId: 17, observedAt: "2026-10-20T06:00:00.000Z",
  scope: { kind: "company", orgUnitId: null }, query: "", statusFilter: "all",
  warning: "Fictional source records", page: { size: 25, hasMore: false, nextCursor: null },
  summary: {
    employeeRecordsThisPage: 1, pendingLeaveRecordsThisPage: 0,
    pendingOvertimeRecordsThisPage: 0, pendingAttendanceCorrectionsThisPage: 0,
    incompletePunchRecordsThisPage: 0,
  },
  items: [{
    id: 18, employeeNo: "FIX-018", name: "Fictional Test Worker", jobTitle: "HR",
    employmentType: "Regular", status: "Active", orgUnitName: "Test unit",
    orgUnitIntegrity: "verified", pendingLeaveRecords: 0, pendingOvertimeRecords: 0,
    pendingAttendanceCorrections: 0, incompletePunchRecords: 0,
  }],
});
const org = () => ({
  tenantId: 17, observedAt: "2026-10-20T06:00:00.000Z",
  currentBusinessDate: "2026-10-20", sources: ["org_units", "positions", "job_profiles"],
  integrity: "ready", unlinkedPositionRecords: 0,
  units: [{
    id: 4, parentId: null, name: "Fictional department", code: "FD",
    type: "Department", depth: 0, relationship: "root", positionRecordCount: 1,
  }],
  positions: [{
    id: 33, code: "FICTIONAL-33", status: "Active", jobTitle: "Test",
    orgUnitId: 4, supervisoryOrgUnitId: null, reportingUnitId: 4, relationship: "linked",
  }],
});
const history = () => ({
  tenantId: 17, positionId: 33, observedAt: "2026-10-20T06:00:00.000Z",
  position: {
    source: "positions", id: 33, code: "FICTIONAL-33",
    status: "Active", currentJobTitle: "Test",
  },
  history: {
    source: "position_assignments",
    preview: {
      hasMore: false, partial: false,
      items: [{
        id: 45, employeeId: 18, assignmentType: "Primary",
        effectiveFrom: "2026-10-01", effectiveUntil: null,
      }],
    },
  },
});
const calendar = () => ({
  organizationId: 17, scope: { kind: "company", orgUnitId: null },
  month: "2026-10", observedAt: "2026-10-20T06:00:00.000Z",
  dates: { start: "2026-10-01", end: "2026-10-31" },
  notice: "Fictional requests", summary: { approvedRequestRecords: 1, pendingRequestRecords: 0 },
  cases: [{
    requestId: 77, employeeId: 18, employeeNo: "FIX-018",
    employeeName: "Fictional Test Worker", status: "Approved",
    startDate: "2026-10-20", endDate: "2026-10-22",
  }],
});
const validTeam = (value: unknown) => validMyTeamResponse(value, 17, 0, "", "all");
const validOrg = (value: unknown) => validOrgExplorerResponse(value, 17);
const validHistory = (value: unknown) => validPositionHistoryResponse(value, 17, 33);
const validCalendar = (value: unknown) =>
  validTeamLeaveResponse(value, 17, "2026-10", { start: "2026-10-01", end: "2026-10-31" });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("role-scoped read failures distinguish authentication, denial and failed sources", () => {
  assert.equal(scopedReadFailureForHttpStatus(401), "sign_in");
  assert.equal(scopedReadFailureForHttpStatus(403), "forbidden");
  for (const status of [404, 408, 429, 500, 502, 503, 504]) {
    assert.equal(scopedReadFailureForHttpStatus(status), "server");
  }
  for (const reason of ["sign_in", "forbidden", "server", "network", "invalid"] as const) {
    assert.ok(scopedReadFailureMessage(reason).length >= 45);
    assert.match(scopedReadFailureMessage(reason), /no records|not an empty record set/i);
  }
});

test("real HTTP response adapters never confuse rejected fetches and malformed 200 JSON", async () => {
  for (const [status, failure] of [[401, "sign_in"], [403, "forbidden"], [503, "server"]] as const) {
    assert.deepEqual(await readScopedResponse(() => Promise.resolve(json({ error: "private" }, status)), validTeam),
      { status: "unavailable", failure });
  }
  assert.deepEqual(await readScopedResponse(() => Promise.reject(new Error("offline")), validTeam),
    { status: "unavailable", failure: "network" });
  assert.deepEqual(await readScopedResponse(
    () => Promise.resolve(new Response("{bad json", { status: 200 })), validTeam),
    { status: "unavailable", failure: "invalid" });
  assert.deepEqual(await readScopedResponse(() => Promise.resolve(json({ ...team(), organizationId: 999 })), validTeam),
    { status: "unavailable", failure: "invalid" });
  assert.deepEqual(await readScopedResponse(() => Promise.resolve(json(team())), validTeam),
    { status: "ready", data: team() });
});

test("every scoped HR validator rejects null/ill-shaped records before React renders", () => {
  assert.equal(validTeam(team()), true);
  assert.equal(validOrg(org()), true);
  assert.equal(validHistory(history()), true);
  assert.equal(validCalendar(calendar()), true);
  assert.equal(validMyTeamResponse(null, 17, 0, "", "all"), false);
  assert.equal(validOrgExplorerResponse([], 17), false);
  assert.equal(validCalendar({ ...calendar(), organizationId: 18 }), false);

  for (const item of [null, 7, "not a member", { id: 18 }]) {
    assert.equal(validTeam({ ...team(), items: [item] }), false);
    assert.equal(validOrg({ ...org(), units: [item] }), false);
    assert.equal(validOrg({ ...org(), positions: [item] }), false);
    assert.equal(validHistory({ ...history(), history: { ...history().history,
      preview: { ...history().history.preview, items: [item] } } }), false);
    assert.equal(validCalendar({ ...calendar(), cases: [item] }), false);
  }
  assert.equal(validTeam({ ...team(), items: [{ ...team().items[0], name: null }] }), false);
  assert.equal(validTeam({ ...team(), summary: { ...team().summary, pendingLeaveRecordsThisPage: 5 } }), false);
  assert.equal(validOrg({ ...org(), integrity: "unknown" }), false);
  assert.equal(validHistory({ ...history(), tenantId: 500 }), false);
  assert.equal(validCalendar({ ...calendar(), cases: [{ ...calendar().cases[0], employeeName: null }] }), false);
  assert.equal(validCalendar({ ...calendar(), summary: { approvedRequestRecords: 0, pendingRequestRecords: 1 } }), false);
});

test("malformed records return invalid, but a retry with valid fictionals succeeds", async () => {
  let calls = 0;
  const result = () => readScopedResponse(async () => {
    calls++;
    return json(calls === 1 ? { ...calendar(), cases: [null] } : calendar());
  }, validCalendar);
  assert.deepEqual(await result(), { status: "unavailable", failure: "invalid" });
  assert.deepEqual(await result(), { status: "ready", data: calendar() });
  assert.equal(calls, 2);
});

test("an aborted scope is discarded even when a delayed HTTP response eventually resolves", async () => {
  const controller = new AbortController();
  let finish!: (value: Response) => void;
  const delayed = new Promise<Response>((resolve) => { finish = resolve; });
  let published = false;
  const pending = readScopedResponse(() => delayed, validTeam).then((result) => {
    if (!controller.signal.aborted) published = result.status === "ready";
  });
  controller.abort();
  finish(json(team()));
  await pending;
  assert.equal(published, false);
});

test("three HCM components preserve abort guards, scoped loading, error announcements and independent retry", () => {
  for (const path of [
    "src/components/hcm-my-team.tsx",
    "src/components/hcm-org-explorer.tsx",
    "src/components/hcm-team-leave-calendar.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /readScopedResponse\(/, path);
    assert.match(source, /controller\.signal\.aborted/, path);
    assert.match(source, /controller\.abort\(\)/, path);
    assert.match(source, /scopedReadFailureMessage\(/, path);
    assert.match(source, /role="alert"/, path);
    assert.match(source, /status: "unavailable", .*: null, failure: result\.failure/, path);
  }
  const orgSource = readFileSync("src/components/hcm-org-explorer.tsx", "utf8");
  assert.match(orgSource, /validOrgExplorerResponse\(payload, organizationId\)/);
  assert.match(orgSource, /validPositionHistoryResponse\(payload, organizationId, selectedPositionId\)/);
  assert.match(orgSource, /setHistoryRevision\(\(value\) => value \+ 1\)/);
  assert.match(readFileSync("src/components/hcm-my-team.tsx", "utf8"), /stored\?\.scopeKey === scopeKey/);
  assert.match(readFileSync("src/components/hcm-team-leave-calendar.tsx", "utf8"), /loaded\?\.requestKey === requestKey/);
});

test("HCM scoped reads reject impossible calendar dates instead of presenting rolled records", async () => {
  const invalidDays = [
    "2026-02-29", "2026-02-30", "2026-04-31", "2026-06-31",
    "2026-13-01", "2026-00-01", "2026-10-00", "2026-10-32",
    "0000-01-01", "2026-10-1", "2026/10/20",
  ];
  for (const day of invalidDays) {
    assert.equal(validOrg({ ...org(), currentBusinessDate: day }), false,
      "org explorer accepted impossible date " + day);
    const badHistory = history();
    assert.equal(validHistory({
      ...badHistory,
      history: { ...badHistory.history, preview: { ...badHistory.history.preview,
        items: [{ ...badHistory.history.preview.items[0], effectiveFrom: day }],
      } },
    }), false, "position history accepted impossible date " + day);
    const badCalendar = calendar();
    assert.equal(validCalendar({
      ...badCalendar,
      cases: [{ ...badCalendar.cases[0], startDate: day, endDate: "2026-10-22" }],
    }), false, "team leave accepted impossible date " + day);
  }

  // Valid leap dates remain readable and cannot be confused with false dates.
  assert.equal(validOrg({ ...org(), currentBusinessDate: "2024-02-29" }), true);
  const h = history();
  assert.equal(validHistory({
    ...h, history: { ...h.history, preview: { ...h.history.preview,
      items: [{ ...h.history.preview.items[0],
        effectiveFrom: "2024-02-29", effectiveUntil: "2024-03-01" }],
    } },
  }), true);

  assert.deepEqual(await readScopedResponse(
    () => Promise.resolve(json({ ...org(), currentBusinessDate: "2026-02-30" })),
    validOrg,
  ), { status: "unavailable", failure: "invalid" },
  "bad 200 JSON must be unavailable, never shown as a verified HR record");
});

test("position history rejects end dates before their effective start", () => {
  const h = history();
  const withInterval = (start: string, end: string | null) => ({
    ...h,
    history: { ...h.history, preview: { ...h.history.preview,
      items: [{ ...h.history.preview.items[0],
        effectiveFrom: start, effectiveUntil: end }],
    } },
  });
  assert.equal(validHistory(withInterval("2026-10-15", "2026-10-14")), false);
  assert.equal(validHistory(withInterval("2026-10-15", "2026-10-15")), true);
  assert.equal(validHistory(withInterval("2026-10-15", "2026-10-16")), true);
  assert.equal(validHistory(withInterval("2026-10-15", null)), true);
});
