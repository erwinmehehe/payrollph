import assert from "node:assert/strict";
import test from "node:test";
import { PEOPLE_OPS_TEAMS } from "../src/lib/hcm-people-operations-inbox";
import { isVerifiedPeopleOperationsPayload } from "../src/lib/hcm-people-operations-response";

const valid = {
  today: "2026-10-19",
  summary: { total: 1, review: 1, followUp: 0, sourceCheck: 0, employeesAffected: 1 },
  attention: { overdue: 1, dueToday: 0, dueNext7: 0, dueNext30: 0, undated: 0 },
  teamLoad: [{ team: PEOPLE_OPS_TEAMS[0], total: 1, review: 1, overdue: 1, dueWithin7: 0 }],
  filteredTotal: 1, page: 1, pageSize: 20, pages: 1,
  rows: [{
    id: "fictional-hr-row", employeeId: 17, employeeNo: "SYN-017",
    employeeName: "Fictional Worker", category: "employment",
    priority: "review", title: "Review source", detail: "Recorded follow-up",
    responsibleTeam: PEOPLE_OPS_TEAMS[0], page: "People",
    dueDate: "2026-10-18", daysUntil: -1,
  }],
  disclaimer: "Read-only fictional follow-ups, not approval evidence.",
};

test("complete synthetic HR inbox snapshot and verified empty result are presentable", () => {
  assert.equal(isVerifiedPeopleOperationsPayload(valid, 1), true);
  const empty = {
    ...valid,
    summary: { total: 0, review: 0, followUp: 0, sourceCheck: 0, employeesAffected: 0 },
    attention: { overdue: 0, dueToday: 0, dueNext7: 0, dueNext30: 0, undated: 0 },
    teamLoad: [], filteredTotal: 0, rows: [],
  };
  assert.equal(isVerifiedPeopleOperationsPayload(empty, 1), true);
});

test("missing totals, malformed rows and incomplete attention fail closed, not as empty success", () => {
  assert.equal(isVerifiedPeopleOperationsPayload({}, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, attention: {} }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, rows: [{}] }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, rows: [] }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, summary: { ...valid.summary, total: 0 } }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, teamLoad: [{}] }, 1), false);
});

test("pagination, duplicate identities and impossible counts are rejected", () => {
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, page: 2 }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, pages: 2 }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, filteredTotal: -1 }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, rows: [{ ...valid.rows[0], employeeId: 0 }] }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, rows: [{ ...valid.rows[0], daysUntil: NaN }] }, 1), false);
  assert.equal(isVerifiedPeopleOperationsPayload(valid, 2), true, "Server may safely clamp an out-of-range page");
});


test("incomplete team breakdown and unknown row team fail closed", () => {
  const team = valid.teamLoad[0];
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, teamLoad: [] }, 1), false,
    "A positive queue must have a reconciled team breakdown");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, teamLoad: [{ ...team, total: 0, review: 0, overdue: 0 }],
  }, 1), false, "A partial team breakdown must not conceal active work");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, teamLoad: [{ ...team, review: 0 }],
  }, 1), false, "Team review count must reconcile to the summary");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, teamLoad: [{ ...team, overdue: 0 }],
  }, 1), false, "Team overdue count must reconcile to the attention bucket");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, teamLoad: [{ ...team, dueWithin7: 1 }],
  }, 1), false, "Team due-within-seven count must match dated attention");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, rows: [{ ...valid.rows[0], responsibleTeam: "Unrecognized owner team" }],
  }, 1), false, "Rows must name a controlled source owner team");
});


test("real calendar dates and due-day arithmetic must verify before HR warnings render", () => {
  assert.equal(isVerifiedPeopleOperationsPayload({ ...valid, today: "2026-02-30" }, 1), false,
    "A syntactically shaped but impossible business date is not trusted");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, rows: [{ ...valid.rows[0], dueDate: "2026-02-30", daysUntil: -231 }],
  }, 1), false, "Impossible source dates are rejected, not normalized");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, rows: [{ ...valid.rows[0], dueDate: "2026-10-18", daysUntil: 4 }],
  }, 1), false, "Forged days-until labels must not contradict the source date");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, rows: [{ ...valid.rows[0], dueDate: null, daysUntil: -1 }],
  }, 1), false, "Undated rows cannot claim an overdue day count");
  assert.equal(isVerifiedPeopleOperationsPayload({
    ...valid, rows: [{ ...valid.rows[0], dueDate: "2026-10-18", daysUntil: null }],
  }, 1), false, "Dated rows require verified day arithmetic");
  assert.equal(isVerifiedPeopleOperationsPayload(valid, 1), true,
    "A genuine source date and derived due-day count remain accepted");
});
