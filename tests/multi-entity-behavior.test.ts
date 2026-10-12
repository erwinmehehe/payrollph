import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { decideEntityAccess, entityResourceAllowed, entityConfirmationMatches, validateLegalEmployerSettingsPatch, VERSIONED_EMPLOYER_FIELDS } from "../src/lib/multi-entity-policy";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { EntityBadge, EntitySwitcher, EntityFilter } from "../src/components/workspace/multi-entity-ui";

const entities = [
  { id: 11, code: "ALPHA", legalName: "Alpha Manufacturing Inc.", displayName: "Alpha" },
  { id: 22, code: "BETA", legalName: "Beta Services Corp.", displayName: "Beta" },
];
const group = { enabled: true as const, group: true, role: "group_hr", legalEntityId: null, entities };
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

test("only dedicated group HR can read all employers in their current tenant", () => {
  const input = { role: "group_hr", availableEntityIds: [11, 22], grantedEntityIds: [] };
  const all = decideEntityAccess({ ...input, requested: "all" });
  assert.equal(all.ok, true);
  assert.equal(entityResourceAllowed(all, 11), true);
  assert.equal(entityResourceAllowed(all, 22), true);
  assert.equal(entityResourceAllowed(all, 33), false);
  assert.equal(decideEntityAccess({ ...input, requested: 33 }).ok, false);
  const selected = decideEntityAccess({ ...input, requested: 22 });
  assert.equal(selected.ok, true);
  assert.equal(entityResourceAllowed(selected, 11), false);
});

test("owner/admin/bookkeeper never inherit cross-entity group access", () => {
  for (const role of ["owner", "admin", "bookkeeper", "hr", "payroll"]) {
    const ungranted = { role, availableEntityIds: [11, 22], grantedEntityIds: [] };
    for (const requested of ["all", null, undefined, 11, 22]) {
      assert.equal(decideEntityAccess({ ...ungranted, requested }).ok, false, String(role) + ":" + String(requested));
    }
    const granted = { ...ungranted, grantedEntityIds: [11] };
    assert.equal(decideEntityAccess({ ...granted, requested: "all" }).ok, false);
    const scoped = decideEntityAccess({ ...granted, requested: 11 });
    assert.equal(entityResourceAllowed(scoped, 11), true);
    assert.equal(entityResourceAllowed(scoped, 22), false);
    assert.equal(decideEntityAccess({ ...granted, requested: 22 }).ok, false);
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

test("legal employer identity and payout changes cannot overwrite a legacy registration", () => {
  for (const field of VERSIONED_EMPLOYER_FIELDS) {
    for (const value of ["changed", "", null]) {
      assert.deepEqual(
        validateLegalEmployerSettingsPatch({
          organizationId: 1, legalEntityId: 11, payrollCalendarMode: "flexible", [field]: value,
        }),
        { ok: false, code: "VERSIONED_REGISTRATION_REQUIRED" },
        field,
      );
    }
  }
  assert.deepEqual(validateLegalEmployerSettingsPatch({
    organizationId: 1, legalEntityId: 11, payrollCalendarMode: "ph_semi_monthly",
  }), { ok: true, payrollCalendarMode: "ph_semi_monthly" });
  for (const bad of [null, [], {}, { organizationId: 1, legalEntityId: 11 },
    { organizationId: 1, legalEntityId: 11, payrollCalendarMode: "weekly" },
    { organizationId: 1, legalEntityId: 11, payrollCalendarMode: "flexible", extraField: "ignore-me" },
  ]) {
    assert.deepEqual(validateLegalEmployerSettingsPatch(bad),
      { ok: false, code: "INVALID_SETTINGS_PATCH" });
  }
});

test("cross-employer transfer mutations have an independent default-off gate", () => {
  for (const value of [undefined, "", "1", "TRUE", "false", "true "]) {
    assert.equal(criticalReleaseFlagEnabled("multiEntityTransfers",
      { MULTI_ENTITY_ENABLED: "true", MULTI_ENTITY_TRANSFERS_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("multiEntityTransfers",
    { MULTI_ENTITY_TRANSFERS_ENABLED: "true" }), true);
});

test("flagged multi-entity blocks every legacy employer creation, update, primary switch and unscopeable directory", () => {
  const route = readFileSync("src/app/api/legal-entities/route.ts", "utf8");
  // All POST and PATCH variants must return before parsing or writing any row.
  const post = route.split("export async function POST(request: Request) {")[1];
  const patch = route.split("export async function PATCH(request: Request) {")[1];
  assert.ok(post && patch);
  for (const operation of [post, patch]) {
    assert.ok(operation.indexOf('criticalReleaseFlagEnabled("multiEntity")')
      < operation.indexOf("const body = await request.json()"),
      "legacy mutation must fail closed before it can operate on a legal employer");
    assert.match(operation, /VERSIONED_REGISTRATION_REQUIRED/);
  }
  const get = route.split("export async function GET(request: Request) {")[1]?.split("export async function POST")[0];
  assert.ok(get?.includes('criticalReleaseFlagEnabled("multiEntity") && !selectorMode'));
  assert.ok(get?.indexOf("await ensurePrimaryLegalEntity(organizationId)")
    > get?.indexOf("if (selectorMode)"),
    "unauthenticated directory GET must never bootstrap a legal employer");
});
