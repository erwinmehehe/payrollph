import assert from "node:assert/strict";
import test from "node:test";
import {
  settlePeopleHomeSourcePreviews,
  projectPeopleHomeFollowUpSources,
  type PeopleHomeSection,
} from "../src/lib/hcm-people-home-worklist";

const section = (items: PeopleHomeSection["items"] = []): PeopleHomeSection => ({
  state: "ready", items, hasMore: false, partial: false, total: null,
});

test("one source failure cannot zero, expose, or erase the other two previews", async () => {
  const valid = section([{
    key: "bp:17", source: "hcm_business_process", sourceId: 17, tenantId: 2,
    title: "Hire", category: "Approval", status: "pending",
    dueAt: null, sourceDate: null, sourceUrl: "/app?organizationId=2",
    incompleteEvidence: false,
  }]);
  const message = "SensitiveSourceFailure: bank 999999999 and employee private data";
  const result = await settlePeopleHomeSourcePreviews(
    Promise.resolve(valid),
    Promise.reject(new Error(message)),
    Promise.resolve(section()),
  );
  assert.equal(result.decisions.state, "ready");
  assert.deepEqual(result.decisions.items, valid.items);
  assert.equal(result.followUps.state, "unavailable");
  assert.equal(result.followUps.partial, true);
  assert.equal(result.followUps.total, null);
  assert.deepEqual(result.followUps.items, []);
  assert.equal(result.ownedCases.state, "ready");
  assert.deepEqual(result.ownedCases.items, []);
  assert.ok(!JSON.stringify(result).includes("SensitiveSourceFailure"));
  assert.ok(!JSON.stringify(result).includes("999999999"));
});

test("all three source failures remain distinguishable from genuine empty work", async () => {
  const rejected = () => Promise.reject(new Error("Synthetic unavailable source"));
  const result = await settlePeopleHomeSourcePreviews(rejected(), rejected(), rejected());
  for (const key of ["decisions", "followUps", "ownedCases"] as const) {
    assert.equal(result[key].state, "unavailable");
    assert.equal(result[key].partial, true);
    assert.equal(result[key].total, null);
    assert.deepEqual(result[key].items, []);
  }
  const empty = await settlePeopleHomeSourcePreviews(
    Promise.resolve(section()), Promise.resolve(section()), Promise.resolve(section()),
  );
  for (const key of ["decisions", "followUps", "ownedCases"] as const) {
    assert.equal(empty[key].state, "ready");
    assert.deepEqual(empty[key].items, []);
  }
});

test("one People Ops sub-source failure preserves verified, employer-bound provisioning", async () => {
  const sourceError = "private bank 99887766, should never appear in a preview";
  const [lifecycle, provisioning] = await Promise.allSettled([
    Promise.reject(new Error(sourceError)),
    Promise.resolve([{
      id: 201, kind: "onboarding", employeeId: 42,
    }]),
  ]);
  const result = projectPeopleHomeFollowUpSources(17, lifecycle, provisioning);
  assert.equal(result.state, "ready");
  assert.equal(result.sourceUnavailable, true);
  assert.equal(result.partial, true);
  assert.equal(result.total, null);
  assert.deepEqual(result.items.map((item) => item.source), ["provisioning"]);
  assert.equal(result.items[0]?.tenantId, 17);
  assert.equal(result.items[0]?.subjectEmployeeId, 42);
  assert.equal(result.items[0]?.sourceUrl,
    "/app?organizationId=17&workspacePage=People&focusEmployeeId=42");
  assert.ok(!JSON.stringify(result).includes(sourceError));
  assert.ok(!JSON.stringify(result).includes("99887766"));
});

test("provisioning outage keeps legitimate lifecycle follow-ups and safe local source dates", async () => {
  const [lifecycle, provisioning] = await Promise.allSettled([
    Promise.resolve([{
      id: 202, dueDate: "2026-10-28", severity: "critical",
    }]),
    Promise.reject(new Error("employee names and private notes must not leak")),
  ]);
  const result = projectPeopleHomeFollowUpSources(21, lifecycle, provisioning);
  assert.equal(result.state, "ready");
  assert.equal(result.sourceUnavailable, true);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items.map((item) => ({
    key: item.key, source: item.source, status: item.status, sourceDate: item.sourceDate,
    dueAt: item.dueAt, tenantId: item.tenantId, incompleteEvidence: item.incompleteEvidence,
  })), [{
    key: "lifecycle:202", source: "lifecycle_notification", status: "review",
    sourceDate: "2026-10-28", dueAt: null, tenantId: 21, incompleteEvidence: true,
  }]);
  assert.ok(!JSON.stringify(result).includes("private notes"));
});

test("two follow-up source errors stay unavailable; dual-success previews stay bounded", async () => {
  const [first, second] = await Promise.allSettled([
    Promise.reject(new Error("source A private failure")),
    Promise.reject(new Error("source B private failure")),
  ]);
  const unavailable = projectPeopleHomeFollowUpSources(17, first, second);
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.partial, true);
  assert.equal(unavailable.total, null);
  assert.deepEqual(unavailable.items, []);
  assert.ok(!JSON.stringify(unavailable).includes("private failure"));

  const [lifecycle, provisioning] = await Promise.allSettled([
    Promise.resolve(Array.from({ length: 7 }, (_, index) => ({
      id: 300 + index, dueDate: "2026-10-28", severity: "normal",
    }))),
    Promise.resolve(Array.from({ length: 7 }, (_, index) => ({
      id: 400 + index, kind: "offboarding", employeeId: 600 + index,
    }))),
  ]);
  const ready = projectPeopleHomeFollowUpSources(17, lifecycle, provisioning);
  assert.equal(ready.state, "ready");
  assert.equal(ready.sourceUnavailable, false);
  assert.equal(ready.items.length, 5);
  assert.equal(ready.hasMore, true);
  assert.equal(ready.partial, true);
  assert.equal(ready.total, null);
  assert.ok(ready.items.every((item) => item.tenantId === 17));
});
