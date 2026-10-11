import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildEmployee360Overview, type Employee360ConnectedSnapshot,
} from "../src/lib/employee-360-overview";

const employee = { title: "People Analyst", status: "Active", employmentType: "Regular" };
const baseProfile: Employee360ConnectedSnapshot = {
  position: {
    profile: { title: "HR Analyst" },
    orgUnit: { name: "Operations" },
    manager: { firstName: "Mina", lastName: "Santos" },
  },
  summary: {
    pendingPolicyAcknowledgements: 2,
    documentComplianceRisks: 1,
  },
  history: {
    employmentEvents: [{ id: 1 }, { id: 2 }],
    positionAssignments: [{ id: 4 }],
  },
  journey: {
    stages: [
      { id: "onboarding", state: "in_progress", detail: "2 of 3 onboarding tasks marked complete." },
      { id: "performance", state: "not_recorded", detail: "No performance review linked." },
    ],
  },
};

function cards(profile: Employee360ConnectedSnapshot | null, state: "ready" | "loading" | "unavailable" | "restricted" = "ready") {
  return buildEmployee360Overview({
    employee,
    leave: [{ status: "Pending" }, { status: "Approved" }],
    profile,
    profileState: state,
  });
}

test("Employee 360 derives only selected worker source records and states", () => {
  const result = cards(baseProfile);
  assert.deepEqual(result.map((card) => card.id),
    ["employment", "onboarding", "documents", "leave", "performance", "history"]);
  assert.equal(result.find((card) => card.id === "employment")?.value, "HR Analyst");
  assert.match(result.find((card) => card.id === "employment")?.detail ?? "", /Mina Santos/);
  assert.equal(result.find((card) => card.id === "onboarding")?.value, "In progress");
  assert.equal(result.find((card) => card.id === "documents")?.value, "3 flagged in source");
  assert.equal(result.find((card) => card.id === "documents")?.tone, "attention");
  assert.equal(result.find((card) => card.id === "leave")?.value, "1 pending in snapshot");
  assert.equal(result.find((card) => card.id === "performance")?.value, "Not linked");
  assert.equal(result.find((card) => card.id === "history")?.value, "2 events shown");
  assert.ok(result.every((card) => card.available));
  assert.ok(result.every((card) => card.targetId === "employee-360-" + card.id));
});

test("empty linked sources do not manufacture completion, compliance or history", () => {
  const result = cards({
    ...baseProfile,
    position: null,
    summary: { pendingPolicyAcknowledgements: 0, documentComplianceRisks: 0 },
    history: { employmentEvents: [], positionAssignments: [] },
    journey: { stages: [
      { id: "onboarding", state: "not_recorded", detail: "No checklist is recorded." },
      { id: "performance", state: "not_recorded", detail: "No linked review." },
    ] },
  });
  assert.equal(result.find((card) => card.id === "employment")?.value, employee.title);
  assert.equal(result.find((card) => card.id === "onboarding")?.value, "Not linked");
  assert.match(result.find((card) => card.id === "documents")?.detail ?? "", /not a compliance certification/);
  assert.equal(result.find((card) => card.id === "history")?.value, "0 events shown");
  assert.match(result.find((card) => card.id === "history")?.detail ?? "", /may omit older history/);
  assert.equal(result.find((card) => card.id === "performance")?.value, "Not linked");
});

test("unavailable, loading or restricted HCM sources never become zero/verified states", () => {
  for (const state of ["loading", "unavailable", "restricted"] as const) {
    const result = cards(null, state);
    assert.equal(result.find((card) => card.id === "employment")?.available, true);
    assert.equal(result.find((card) => card.id === "leave")?.available, true);
    for (const id of ["onboarding", "documents", "performance", "history"]) {
      const item = result.find((card) => card.id === id)!;
      assert.equal(item.available, false, id + " / " + state);
      assert.equal(item.tone, "unavailable");
      assert.ok(!item.value.includes("0"));
      assert.ok(!item.value.toLowerCase().includes("complete"));
    }
  }
  const badReady = cards(null, "ready");
  assert.equal(badReady.find((card) => card.id === "documents")?.value, "Unavailable");
});

test("an absent journey stage remains unavailable even if other HCM fields loaded", () => {
  const result = cards({ ...baseProfile, journey: { stages: [] } });
  assert.equal(result.find((card) => card.id === "onboarding")?.available, false);
  assert.equal(result.find((card) => card.id === "performance")?.available, false);
  assert.equal(result.find((card) => card.id === "documents")?.available, true);
});

test("Employee 360 is mounted only for authorized People administration and resets per worker", () => {
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const overview = readFileSync("src/components/employee-360-overview.tsx", "utf8");
  assert.ok(people.includes("key={data.selectedOrganization.id + \":\" + selected.id}"));
  assert.ok(people.includes("{canManage && (") && people.includes("<Employee360Overview"));
  assert.ok(people.includes("profile: connectedProfile"));
  assert.ok(people.includes("profileState,"));
  for (const id of ["employment", "onboarding", "documents", "leave", "performance", "history"]) {
    assert.ok(people.includes("id=\"employee-360-" + id + "\""), id);
  }
  assert.ok(overview.includes("disabled={isUnavailable}"));
  assert.ok(overview.includes("document.getElementById(card.targetId)"));
  assert.ok(overview.includes("target.focus({ preventScroll: true })"));
  for (const unsafe of ["fetch(", "api/", "onPage(", "db.update(", "db.insert(", "payrollRuns"]) {
    assert.ok(!overview.includes(unsafe), unsafe);
  }
});
