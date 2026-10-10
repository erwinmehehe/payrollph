import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  boundedPeopleHomeRows, delegatedHcmAssigneeMatches,
  HCM_PEOPLE_HOME_CASE_LIMIT, HCM_PEOPLE_HOME_DECISION_LIMIT,
  HCM_PEOPLE_HOME_FOLLOWUP_LIMIT, unavailablePeopleHomeSlice,
} from "../src/lib/hcm-people-home-bounds";

test("bounded previews distinguish a capped page from a complete page", () => {
  assert.deepEqual(boundedPeopleHomeRows([1, 2, 3], 2), { rows: [1, 2], hasMore: true });
  assert.deepEqual(boundedPeopleHomeRows([1, 2], 2), { rows: [1, 2], hasMore: false });
  assert.throws(() => boundedPeopleHomeRows([1], 0));
  assert.ok(HCM_PEOPLE_HOME_DECISION_LIMIT <= 50);
  assert.ok(HCM_PEOPLE_HOME_FOLLOWUP_LIMIT <= 20);
  assert.ok(HCM_PEOPLE_HOME_CASE_LIMIT <= 50);
  assert.deepEqual(unavailablePeopleHomeSlice(), {
    status: "unavailable", items: [], partial: true, hasMore: null,
  });
});

test("delegation resolution handles case, three hops, and cycles", () => {
  const edges = [
    { fromApprover: "Alice", toApprover: "Bob" },
    { fromApprover: "Bob", toApprover: "Carol" },
    { fromApprover: "Carol", toApprover: "Dan" },
    { fromApprover: "Dan", toApprover: "Eve" },
  ];
  assert.equal(delegatedHcmAssigneeMatches("ALICE", "alice", edges), true);
  assert.equal(delegatedHcmAssigneeMatches("Alice", "carol", edges), true);
  assert.equal(delegatedHcmAssigneeMatches("Alice", "DAN", edges), true);
  assert.equal(delegatedHcmAssigneeMatches("Alice", "eve", edges), false);
  assert.equal(delegatedHcmAssigneeMatches("Alice", "Mallory", edges), false);
  const cycle = [{ fromApprover: "Alice", toApprover: "Bob" }, { fromApprover: "Bob", toApprover: "Alice" }];
  assert.equal(delegatedHcmAssigneeMatches("Alice", "Bob", cycle), true);
  assert.equal(delegatedHcmAssigneeMatches("Alice", "Mallory", cycle), false);
});

test("People Home is scoped, server-minimized, and default off", () => {
  const api = readFileSync("src/app/api/hcm/people-home/route.ts", "utf8");
  const server = readFileSync("src/lib/hcm-people-home-server.ts", "utf8");
  const home = readFileSync("src/components/hcm-people-home.tsx", "utf8");
  assert.match(api, /NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED !== "true"/);
  assert.match(api, /assertOrganizationRole/);
  assert.match(api, /companyWide/);
  assert.match(api, /"owner", "admin", "hr"/);
  assert.match(api, /private, no-store/);
  assert.match(server, /Promise\.allSettled/);
  assert.match(server, /limit\(HCM_PEOPLE_HOME_DECISION_LIMIT \+ 1\)/);
  assert.match(server, /limit\(HCM_PEOPLE_HOME_DELEGATION_LIMIT \+ 1\)/);
  assert.match(server, /limit\(limit \+ 1\)/);
  assert.match(server, /HCM_PEOPLE_HOME_CASE_LIMIT \+ 1/);
  assert.match(server, /eq\(employees\.organizationId, organizationId\)/);
  assert.ok(!server.includes("canDecide("));
  assert.ok(!server.includes("loadPeopleOperationsInbox("));
  assert.ok(!server.includes("SELECT *"));
  assert.ok(!server.includes("c.detail"));
  assert.ok(!server.includes("ownerName"));
  assert.ok(home.includes("/api/hcm/people-home?organizationId="));
  assert.ok(!home.includes("/api/hcm/business-processes/inbox?organizationId="));
  assert.ok(!home.includes('method: "POST"'));
  assert.ok(!home.includes('method: "PATCH"'));
});
