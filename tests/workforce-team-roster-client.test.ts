import assert from "node:assert/strict";
import test from "node:test";
import {
  activeTeamRosterPayload,
  teamRosterScopeKey,
} from "../src/lib/workforce-team-roster-client";

test("weekly roster scope is unique per tenant, week, worker page and search", () => {
  const original = teamRosterScopeKey(21, "2026-10-05", 1, "jo");
  const view = { scopeKey: original, data: { rows: ["A worker"], shifts: [] } };
  assert.deepEqual(activeTeamRosterPayload(view, original), view.data);
  assert.equal(activeTeamRosterPayload(view, teamRosterScopeKey(22, "2026-10-05", 1, "jo")), null);
  assert.equal(activeTeamRosterPayload(view, teamRosterScopeKey(21, "2026-10-12", 1, "jo")), null);
  assert.equal(activeTeamRosterPayload(view, teamRosterScopeKey(21, "2026-10-05", 2, "jo")), null);
  assert.equal(activeTeamRosterPayload(view, teamRosterScopeKey(21, "2026-10-05", 1, "john")), null);
  assert.equal(activeTeamRosterPayload(null, original), null);
});

test("roster request key cannot collide through search delimiters", () => {
  const a = teamRosterScopeKey(1, "2026-10-05", 2, "x:3:staff");
  const b = teamRosterScopeKey(1, "2026-10-05", 2, "x:3");
  const c = teamRosterScopeKey(1, "2026-10-05", 3, "x:3:staff");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
