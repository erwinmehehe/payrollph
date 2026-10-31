import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CalendarItem } from "../src/lib/compliance-calendar-read";
import {
  countComplianceAgencies, needsComplianceAttention, selectComplianceCalendarItems,
} from "../src/lib/compliance-calendar-planner";

function row(id: string, agency: CalendarItem["agency"], dueDate: string | null,
  status: CalendarItem["status"]): CalendarItem {
  return {
    id, agency, dueDate, status, obligation: "Fictional obligation",
    applicableMonth: "2026-10", detail: "Synthetic status, not filing evidence",
    sourceLabel: "Source", sourceUrl: "https://example.org",
    exactness: "nominal",
  };
}
const rows = [
  row("A", "BIR", "2026-11-01", "upcoming"),
  row("B", "SSS", null, "configuration-required"),
  row("C", "PhilHealth", "2026-10-20", "overdue"),
  row("D", "Pag-IBIG", "2026-10-10", "complete"),
  row("E", "BIR", "2026-11-05", "due-soon"),
];

test("verified-source agency counts and attention statuses never infer completion", () => {
  assert.deepEqual(countComplianceAgencies(rows), {
    all: 5, BIR: 2, SSS: 1, PhilHealth: 1, "Pag-IBIG": 1, unresolved: 1,
  });
  assert.equal(needsComplianceAttention("complete"), false);
  assert.equal(needsComplianceAttention("upcoming"), false);
  assert.equal(needsComplianceAttention("configuration-required"), true);
  assert.equal(needsComplianceAttention("verification-required"), true);
  assert.deepEqual(countComplianceAgencies([]), {
    all: 0, BIR: 0, SSS: 0, PhilHealth: 0, "Pag-IBIG": 0, unresolved: 0,
  });
});

test("agency filters and due-date sorts remain stable, nonmutating and unknown-date-safe", () => {
  const original = structuredClone(rows);
  assert.deepEqual(selectComplianceCalendarItems(rows, false, "all", "source").map(x => x.id),
    ["A", "B", "C", "D", "E"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, false, "all", "earliest").map(x => x.id),
    ["D", "C", "A", "E", "B"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, false, "all", "latest").map(x => x.id),
    ["E", "A", "C", "D", "B"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, true, "all", "earliest").map(x => x.id),
    ["C", "E", "B"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, false, "BIR", "earliest").map(x => x.id),
    ["A", "E"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, true, "BIR", "earliest").map(x => x.id),
    ["E"]);
  assert.deepEqual(selectComplianceCalendarItems(rows, true, "Pag-IBIG", "source"), []);
  assert.deepEqual(rows, original);
});

test("client retains tenant-verified reads, read-only controls and conservative date labels", () => {
  const ui = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
  const helper = readFileSync("src/lib/compliance-calendar-planner.ts", "utf8");
  assert.match(ui, /readVerifiedComplianceCalendar\(organizationId, fetch, signal\)/);
  assert.match(ui, /"compliance-calendar:" \+ organizationId/);
  assert.match(ui, /selectComplianceCalendarItems\(payload\?\.items \?\? \[\], attentionOnly, agencyFilter, dateSort\)/);
  assert.match(ui, /conservative internal target/);
  assert.match(ui, /No obligations match the selected filters/);
  assert.doesNotMatch(helper, /fetch\(|db\.(?:insert|update|delete)|localStorage|sessionStorage/);
});
