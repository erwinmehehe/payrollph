import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { focusEmployee360Section } from "../src/lib/employee-360-focus";
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
      { id: "compensation", state: "in_progress", detail: "Proposal #4 awaits approval; no pay change." },
      { id: "payroll", state: "not_recorded", detail: "No Released payroll entry linked; non-payment cannot be inferred." },
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
    ["employment", "onboarding", "documents", "leave", "performance", "compensation", "payroll", "history"]);
  assert.equal(result.find((card) => card.id === "employment")?.value, "HR Analyst");
  assert.match(result.find((card) => card.id === "employment")?.detail ?? "", /Mina Santos/);
  assert.equal(result.find((card) => card.id === "onboarding")?.value, "In progress");
  assert.equal(result.find((card) => card.id === "documents")?.value, "3 flagged in source");
  assert.equal(result.find((card) => card.id === "documents")?.tone, "attention");
  assert.equal(result.find((card) => card.id === "leave")?.value, "1 pending in snapshot");
  assert.equal(result.find((card) => card.id === "performance")?.value, "Not linked");
  assert.equal(result.find((card) => card.id === "history")?.value, "2 events shown");
  assert.equal(result.find((card) => card.id === "compensation")?.value, "In progress");
  assert.equal(result.find((card) => card.id === "compensation")?.tone, "attention");
  assert.equal(result.find((card) => card.id === "payroll")?.value, "Not linked");
  assert.ok(result.find((card) => card.id === "payroll")?.detail.includes("cannot be inferred"));
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
    for (const id of ["onboarding", "documents", "performance", "compensation", "payroll", "history"]) {
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
  assert.equal(result.find((card) => card.id === "compensation")?.available, false);
  assert.equal(result.find((card) => card.id === "payroll")?.available, false);
  assert.equal(result.find((card) => card.id === "documents")?.available, true);
});

test("restricted financial stages do not reveal compensation or pay details", () => {
  const guarded = cards({
    ...baseProfile,
    journey: { stages: [
      { id: "compensation", state: "restricted", detail: "CONFIDENTIAL compensation proposal" },
      { id: "payroll", state: "restricted", detail: "CONFIDENTIAL released payroll entry" },
    ] },
  });
  for (const id of ["compensation", "payroll"]) {
    const card = guarded.find((item) => item.id === id);
    assert.equal(card?.value, "Restricted");
    assert.equal(card?.available, false);
    assert.equal(card?.tone, "unavailable");
    assert.ok(!JSON.stringify(card).includes("CONFIDENTIAL"));
  }
  const noStages = cards({ ...baseProfile, journey: { stages: [] } });
  assert.equal(noStages.find((item) => item.id === "compensation")?.available, false);
  assert.equal(noStages.find((item) => item.id === "payroll")?.available, false);
});

test("financial stages are evidence rather than salary authorization or bank settlement", () => {
  const result = cards({
    ...baseProfile,
    journey: { stages: [
      { id: "compensation", state: "recorded", detail: "Applied proposal recorded; no payout implied." },
      { id: "payroll", state: "recorded", detail: "Released payroll entry; bank settlement remains unverified." },
    ] },
  });
  const compensation = result.find((item) => item.id === "compensation");
  const payroll = result.find((item) => item.id === "payroll");
  assert.equal(compensation?.value, "Recorded");
  assert.equal(payroll?.value, "Recorded");
  assert.equal(compensation?.targetId, "employee-360-compensation");
  assert.equal(payroll?.targetId, "employee-360-payroll");
  assert.ok(payroll?.detail.includes("unverified"));
  assert.ok(result.every((item) => !/bank settled|funds disbursed|payroll approved/i.test(item.detail)));
});

test("Employee 360 section navigation focuses non-focusable targets without trapping Tab", () => {
  const events: string[] = [];
  const blurHandlers: Array<() => void> = [];
  let tabIndex: string | null = null;
  const target = {
    hasAttribute: (name: string) => name === "tabindex" && tabIndex !== null,
    setAttribute: (name: string, value: string) => {
      assert.equal(name, "tabindex");
      tabIndex = value;
      events.push("set:" + value);
    },
    removeAttribute: (name: string) => {
      assert.equal(name, "tabindex");
      tabIndex = null;
      events.push("restore");
    },
    addEventListener: (name: string, callback: () => void, options: { once: boolean }) => {
      assert.equal(name, "blur");
      assert.equal(options.once, true);
      blurHandlers.push(callback);
    },
    focus: (options: { preventScroll: boolean }) => {
      assert.deepEqual(options, { preventScroll: true });
      events.push("focus");
    },
    scrollIntoView: (options: { behavior: string; block: string }) => {
      events.push("scroll:" + options.behavior + ":" + options.block);
    },
  } as unknown as HTMLElement;

  focusEmployee360Section(target, true);
  assert.equal(tabIndex, "-1");
  assert.deepEqual(events, ["set:-1", "focus", "scroll:auto:start"]);
  assert.equal(blurHandlers.length, 1);
  blurHandlers[0]();
  assert.equal(tabIndex, null, "temporary tabIndex must be removed on blur");

  tabIndex = "0";
  events.length = 0;
  focusEmployee360Section(target, false);
  assert.equal(tabIndex, "0", "an existing focus policy must not be overwritten");
  assert.deepEqual(events, ["focus", "scroll:smooth:start"]);
  assert.equal(blurHandlers.length, 1, "pre-existing tabIndex needs no cleanup listener");
});

test("Employee 360 is mounted only for authorized People administration and resets per worker", () => {
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const overview = readFileSync("src/components/employee-360-overview.tsx", "utf8");
  assert.ok(people.includes("key={data.selectedOrganization.id + \":\" + selected.id + \":\" + String(canManage)}"));
  assert.ok(people.includes("{canManage && (") && people.includes("<Employee360Overview"));
  assert.ok(people.includes("profile: connectedProfile"));
  assert.ok(people.includes("profileState,"));
  for (const id of ["employment", "onboarding", "documents", "leave", "performance", "history"]) {
    assert.ok(people.includes("id=\"employee-360-" + id + "\""), id);
  }
  const journeyPanel = readFileSync("src/components/hcm-worker-journey-panel.tsx", "utf8");
  assert.ok(people.includes("<HcmWorkerJourneyPanel"));
  assert.ok(journeyPanel.includes('item.id === "compensation" || item.id === "payroll"'));
  assert.ok(journeyPanel.includes('"employee-360-" + item.id'));
  assert.ok(journeyPanel.includes('tabIndex={item.id === "compensation" || item.id === "payroll" ? -1 : undefined}'));
  assert.ok(overview.includes("disabled={isUnavailable}"));
  assert.ok(overview.includes("document.getElementById(card.targetId)"));
  assert.ok(overview.includes("focusEmployee360Section("));
  assert.ok(overview.includes("aria-controls={card.available ? card.targetId : undefined}"));
  for (const unsafe of ["fetch(", "api/", "onPage(", "db.update(", "db.insert(", "payrollRuns"]) {
    assert.ok(!overview.includes(unsafe), unsafe);
  }
});
