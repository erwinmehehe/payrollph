import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isValidHcmReadScope } from "../src/lib/hcm-read-scope-validation";
import { deriveMyTeamScope } from "../src/lib/hcm-my-team-contract";
import { deriveTeamLeaveScope } from "../src/lib/hcm-team-leave-calendar-contract";

test("company-wide and explicitly assigned-unit read scopes are accepted", () => {
  assert.equal(isValidHcmReadScope({ kind: "company", orgUnitId: null }), true);
  assert.equal(isValidHcmReadScope({ kind: "unit", orgUnitId: 1 }), true);
  assert.equal(isValidHcmReadScope({ kind: "unit", orgUnitId: Number.MAX_SAFE_INTEGER }), true);
  for (const derive of [deriveMyTeamScope, deriveTeamLeaveScope]) {
    assert.equal(isValidHcmReadScope(derive({
      role: "hr", companyWide: true, orgUnitId: null,
    })), true);
    assert.equal(isValidHcmReadScope(derive({
      role: "manager", companyWide: false, orgUnitId: 42,
    })), true);
  }
});

test("unknown, inconsistent and invalid runtime scopes are rejected", () => {
  const invalid: unknown[] = [
    undefined, null, "company", 0, [], {},
    { kind: "other", orgUnitId: null },
    { kind: "manager", orgUnitId: 42 },
    { kind: "company" },
    { kind: "company", orgUnitId: 42 },
    { kind: "company", orgUnitId: undefined },
    { kind: "unit" },
    { kind: "unit", orgUnitId: null },
    { kind: "unit", orgUnitId: "42" },
    { kind: "unit", orgUnitId: 0 },
    { kind: "unit", orgUnitId: -1 },
    { kind: "unit", orgUnitId: 1.5 },
    { kind: "unit", orgUnitId: Number.NaN },
    { kind: "unit", orgUnitId: Number.POSITIVE_INFINITY },
    { kind: "unit", orgUnitId: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const scope of invalid) {
    assert.equal(isValidHcmReadScope(scope), false, JSON.stringify(scope));
  }
});

test("both server loaders enforce the scope guard before touching SQL", () => {
  for (const path of [
    "src/lib/hcm-my-team-server.ts",
    "src/lib/hcm-team-leave-calendar-server.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /import \{ isValidHcmReadScope \} from "@\/lib\/hcm-read-scope-validation"/);
    assert.match(source, /!isValidHcmReadScope\(scope\)/);
    const guardAt = source.indexOf("!isValidHcmReadScope(scope)");
    const firstQueryAt = source.indexOf("db.select(");
    assert.ok(guardAt >= 0 && firstQueryAt > guardAt,
      "scope must be validated before the first employer SQL query: " + path);
    assert.match(source, /eq\(employees\.organizationId, organizationId\)/,
      "existing employer scope must remain in all workforce SQL queries: " + path);
  }
});
