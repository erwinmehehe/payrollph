import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  paginatePeopleOperationsItems,
  summarizePeopleOperationsAttention,
  PEOPLE_OPS_TEAMS,
  type PeopleOpsItem,
} from "../src/lib/hcm-people-operations-inbox";

const TODAY = "2026-10-09";
const employment = PEOPLE_OPS_TEAMS[0];
const tech = PEOPLE_OPS_TEAMS[1];
const performance = PEOPLE_OPS_TEAMS[3];
const separation = PEOPLE_OPS_TEAMS[4];

function row(
  id: number,
  dueDate: string | null,
  responsibleTeam: string = employment,
  priority: PeopleOpsItem["priority"] = "follow_up",
): PeopleOpsItem {
  return {
    id: "employment:" + id,
    employeeId: id,
    employeeNo: "E-" + id,
    employeeName: "Example Worker " + id,
    category: "employment",
    priority,
    title: "Review sourced case",
    detail: "Source-backed follow-up, not a legal finding.",
    responsibleTeam,
    page: "People",
    dueDate,
    daysUntil: null,
  };
}

const backlog: PeopleOpsItem[] = [
  row(1, "2026-10-08", employment, "review"),
  row(2, "2026-09-30", separation, "review"),
  row(3, "2026-10-09", tech),
  row(4, "2026-10-10", tech),
  row(5, "2026-10-16", employment),
  row(6, "2026-10-17", performance),
  row(7, "2026-11-08", performance),
  row(8, "2026-11-09", tech),
  row(9, null, employment, "source_check"),
];

test("daily triage buckets are disjoint, use Philippine YYYY-MM-DD business dates and preserve later work", () => {
  const result = paginatePeopleOperationsItems(TODAY, backlog);
  assert.deepEqual(result.attention, {
    overdue: 2, dueToday: 1, dueNext7: 2, dueNext30: 2, undated: 1,
  });
  assert.equal(result.summary.total, 9);
  assert.equal(result.summary.employeesAffected, 9);
  assert.equal(result.teamLoad.reduce((count, team) => count + team.total, 0), 9);
  assert.equal(result.rows.length, 9);
  assert.equal(result.rows.some((value) => value.employeeId === 8), true);
});

test("overdue, today, next7, next30, undated filters isolate exact source-date cohorts", () => {
  const matches = (dueWindow: "overdue" | "today" | "next7" | "next30" | "unscheduled") =>
    paginatePeopleOperationsItems(TODAY, backlog, { dueWindow }).rows.map((value) => value.employeeId);
  assert.deepEqual(matches("overdue"), [1, 2]);
  assert.deepEqual(matches("today"), [3]);
  assert.deepEqual(matches("next7"), [3, 4, 5]);
  assert.deepEqual(matches("next30"), [3, 4, 5, 6, 7]);
  assert.deepEqual(matches("unscheduled"), [9]);
  assert.equal(paginatePeopleOperationsItems(TODAY, backlog, { dueWindow: "next30" }).filteredTotal, 5);
});

test("team queue filters operate after source authorization and keep whole-tenant summary", () => {
  const result = paginatePeopleOperationsItems(TODAY, backlog, {
    team: tech, dueWindow: "next7", pageSize: 1, page: 2,
  });
  assert.equal(result.filteredTotal, 2);
  assert.equal(result.pages, 2);
  assert.equal(result.page, 2);
  assert.deepEqual(result.rows.map((value) => value.employeeId), [4]);
  assert.equal(result.summary.total, 9);
  assert.equal(result.attention.overdue, 2);
  assert.equal(result.teamLoad.find((value) => value.team === tech)?.total, 3);
  assert.ok(result.teamLoad.every((value) => PEOPLE_OPS_TEAMS.includes(value.team)));
});

test("grouped workload distinguishes source milestones from formal case SLAs", () => {
  const { teamLoad } = summarizePeopleOperationsAttention(TODAY, backlog);
  const employmentLoad = teamLoad.find((entry) => entry.team === employment);
  assert.deepEqual(employmentLoad, {
    team: employment, total: 3, review: 1, overdue: 1, dueWithin7: 1,
  });
  const techLoad = teamLoad.find((entry) => entry.team === tech);
  assert.deepEqual(techLoad, { team: tech, total: 3, review: 0, overdue: 0, dueWithin7: 2 });
  assert.equal(teamLoad[0].team, employment);
  assert.equal(teamLoad[1].team, separation);
});

test("calendar boundaries, invalid dates, empty queues and missing due dates fail neutral", () => {
  const boundary = [
    row(10, "2026-12-31"), row(11, "2027-01-01"), row(12, "2027-01-08"),
    row(13, "2027-01-09"), row(14, "not-a-date"), row(15, null),
  ];
  const { attention } = summarizePeopleOperationsAttention("2027-01-01", boundary);
  assert.deepEqual(attention, {
    overdue: 1, dueToday: 1, dueNext7: 1, dueNext30: 1, undated: 2,
  });
  const empty = paginatePeopleOperationsItems(TODAY, [], { team: employment, dueWindow: "overdue" });
  assert.equal(empty.filteredTotal, 0);
  assert.equal(empty.pages, 1);
  assert.equal(empty.attention.undated, 0);
  assert.deepEqual(empty.teamLoad, []);
});

test("triage is a pure read-only projection and cannot mutate HR input", () => {
  const frozen = structuredClone(backlog);
  const a = paginatePeopleOperationsItems(TODAY, backlog, { dueWindow: "overdue" });
  const b = paginatePeopleOperationsItems(TODAY, backlog, { team: tech });
  assert.equal(a.rows.length, 2);
  assert.equal(b.rows.length, 3);
  assert.deepEqual(backlog, frozen);
});

test("API guards company-wide People role before loading sources and validates team/horizon", () => {
  const source = readFileSync("src/app/api/hcm/people-operations-inbox/route.ts", "utf8");
  assert.ok(source.includes("assertOrganizationRole("));
  assert.ok(source.includes("PEOPLE_ADMIN_ROLES"));
  assert.ok(source.includes("!access?.companyWide"));
  assert.ok(source.indexOf("assertOrganizationRole(") < source.indexOf("loadPeopleOperationsInbox(organizationId,"));
  assert.ok(source.includes("!DUE_WINDOWS.has(dueWindow)"));
  assert.ok(source.includes("!TEAMS.has(team)"));
  assert.ok(source.includes("PEOPLE_OPS_TEAMS"));
  assert.ok(source.includes("private, no-store"));
  assert.ok(!source.includes("export async function POST"));
  assert.ok(!source.includes("export async function PATCH"));
});

test("daily triage stays in native People Inbox with source navigation and no write actions", () => {
  const ui = readFileSync("src/components/hcm-people-operations-inbox.tsx", "utf8");
  assert.ok(ui.includes("HR daily triage"));
  assert.ok(ui.includes("data.attention.dueToday + data.attention.dueNext7"));
  assert.ok(ui.includes("data.attention.dueToday + data.attention.dueNext7 + data.attention.dueNext30"));
  assert.ok(ui.includes("Team workload across the organization"));
  assert.ok(ui.includes("Filter People Operations by source due date"));
  assert.ok(ui.includes("Filter People Operations by responsible team"));
  assert.ok(ui.includes("onPage(row.page)"));
  assert.ok(ui.includes("controller.abort()"));
  assert.ok(ui.includes("response?.organizationId === organizationId"));
  assert.ok(!ui.includes('method: "POST"'));
  assert.ok(!ui.includes('method: "PATCH"'));
});
