import assert from "node:assert/strict";
import test from "node:test";
import { EMPLOYEE_360_SECTIONS, cardsForEmployee360Section, latestLinkedEffectiveDate } from "../src/lib/employee-360-navigation";
import type { Employee360Card } from "../src/lib/employee-360-overview";

test("six navigation sections preserve source-owned card references without a new API", () => {
  assert.deepEqual(EMPLOYEE_360_SECTIONS.map(s => s.label), [
    "Overview", "Job & Organization", "Leave", "Documents", "Performance", "History",
  ]);
  const cards: Employee360Card[] = ["employment", "onboarding", "documents", "leave", "performance", "compensation", "payroll", "history"]
    .map(id => ({ id: id as Employee360Card["id"], title: id, value: "Recorded", detail: "From source",
      targetId: "employee-360-" + id, source: "Authorized source", available: true, tone: "neutral" }));
  const grouped = EMPLOYEE_360_SECTIONS.flatMap(group => cardsForEmployee360Section(cards, group.id));
  assert.equal(grouped.length, cards.length);
  assert.equal(new Set(grouped.map(card => card.id)).size, cards.length);
  assert.deepEqual(cardsForEmployee360Section(cards, "job").map(c => c.id), ["employment", "compensation"]);
  assert.deepEqual(cardsForEmployee360Section(cards, "history").map(c => c.targetId), ["employee-360-history"]);
});

test("history dates come only from valid effective-dated employment events and assignments", () => {
  assert.equal(latestLinkedEffectiveDate({
    employmentEvents: [{ effectiveDate: "2026-02-15" }, { effectiveDate: "2026-02-30" }, { updatedAt: "2027-01-01" }],
    positionAssignments: [{ effectiveFrom: "2026-05-01" }, { effectiveFrom: "not-a-date" }],
  }), "2026-05-01");
  assert.equal(latestLinkedEffectiveDate({
    employmentEvents: [{ id: 3, createdAt: "2026-05-01" }],
    positionAssignments: [{ id: 8, updatedAt: "2026-05-01" }],
  }), null);
});
