import assert from "node:assert/strict";
import test from "node:test";
import {
  settlePeopleHomeSourcePreviews,
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
