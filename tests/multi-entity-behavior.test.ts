import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed, entityConfirmationMatches } from "../src/lib/multi-entity-policy";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { EntityBadge, EntitySwitcher, EntityFilter } from "../src/components/workspace/multi-entity-ui";

const entities = [
  { id: 11, code: "ALPHA", legalName: "Alpha Manufacturing Inc.", displayName: "Alpha" },
  { id: 22, code: "BETA", legalName: "Beta Services Corp.", displayName: "Beta" },
];
const group = { enabled: true as const, group: true, role: "owner", legalEntityId: null, entities };
const scoped = { enabled: true as const, group: false, role: "hr", legalEntityId: 11, entities: [entities[0]] };

test("MULTI_ENTITY_ENABLED is false for unset, wrong case and invalid values", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "true "]) {
    assert.equal(criticalReleaseFlagEnabled("multiEntity", { MULTI_ENTITY_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("multiEntity", { MULTI_ENTITY_ENABLED: "true" }), true);
});

test("entity-scoped personnel cannot escalate to another entity or All", () => {
  const base = { role: "hr", availableEntityIds: [11, 22], grantedEntityIds: [11] };
  const allow = decideEntityAccess({ ...base, requested: 11 });
  assert.deepEqual(allow, { ok: true, group: false, selectedEntityId: 11, allowedEntityIds: [11] });
  assert.equal(entityResourceAllowed(allow, 11), true);
  for (const requested of [22, 999, null, "all", "-1", "0", "22foo"]) {
    const decision = decideEntityAccess({ ...base, requested });
    assert.equal(decision.ok, false, String(requested));
    assert.equal(entityResourceAllowed(decision, 11), false);
  }
  assert.equal(entityResourceAllowed(allow, 22), false);
  assert.equal(entityResourceAllowed(allow, null), false);
});

test("group roles can see all within their actual tenant, not guessed foreign entity IDs", () => {
  for (const role of ["owner", "admin", "bookkeeper", "group_hr"]) {
    const input = { role, availableEntityIds: [11, 22], grantedEntityIds: [] };
    const all = decideEntityAccess({ ...input, requested: "all" });
    assert.equal(all.ok, true);
    assert.equal(entityResourceAllowed(all, 11), true);
    assert.equal(entityResourceAllowed(all, 22), true);
    assert.equal(entityResourceAllowed(all, 33), false); // Group never crosses tenant boundary.
    const foreign = decideEntityAccess({ ...input, requested: 33 });
    assert.equal(foreign.ok, false);
    const selected = decideEntityAccess({ ...input, requested: 22 });
    assert.equal(selected.ok, true);
    assert.equal(entityResourceAllowed(selected, 11), false);
  }
});

test("legal employer confirmation fails closed for missing, different or partial names", () => {
  for (const value of ["", "Alpha", "alpha manufacturing inc.", "Beta Services Corp.", "Alpha Manufacturing Inc"]) {
    assert.equal(entityConfirmationMatches("Alpha Manufacturing Inc.", value), false);
  }
  assert.equal(entityConfirmationMatches("Alpha Manufacturing Inc.", "Alpha Manufacturing Inc."), true);
});

test("flag-off entity widgets preserve empty legacy markup, including no switcher", () => {
  assert.equal(renderToStaticMarkup(createElement(EntityBadge, { legalEntityId: 11 })), "");
  assert.equal(renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1 })), "");
  assert.equal(renderToStaticMarkup(createElement(EntityFilter, { organizationId: 1 })), "");
});

test("group-only switcher visibility is executed in server-rendered React", () => {
  const groupMarkup = renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1, context: group }));
  const scopeMarkup = renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1, context: scoped }));
  assert.match(groupMarkup, /Legal entity switcher/);
  assert.match(groupMarkup, /All entities/);
  assert.match(groupMarkup, /Beta/);
  assert.doesNotMatch(scopeMarkup, /<select/);
  assert.doesNotMatch(scopeMarkup, /All entities/);
  assert.match(scopeMarkup, /Assigned legal employer/);
  const badge = renderToStaticMarkup(createElement(EntityBadge, { legalEntityId: 22, context: group }));
  assert.match(badge, /Beta/);
  assert.doesNotMatch(badge, /Alpha Manufacturing Inc/);
});
