import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveExplicitEntitySelection } from "../src/lib/multi-entity-selector-boundary";
import { decideEntityAccess } from "../src/lib/multi-entity-policy";

const grants = {
  role: "hr",
  availableEntityIds: [101, 102],
  grantedEntityIds: [101],
};

test("salary-case GET without a query/header selects the authorized grant rather than all employers", () => {
  const implicit = resolveExplicitEntitySelection({ queryValues: [], header: null });
  assert.deepEqual(implicit, { ok: true, requested: undefined, explicit: false });
  if (!implicit.ok) throw Error("Expected implicit selector.");
  const allowed = decideEntityAccess({ ...grants, requested: implicit.requested });
  assert.deepEqual(allowed, {
    ok: true, group: false, selectedEntityId: 101, allowedEntityIds: [101],
  });

  // This was the bug: URLSearchParams.get returns null on a missing key.
  const mistaken = resolveExplicitEntitySelection({ requested: null, queryValues: [], header: null });
  assert.deepEqual(mistaken, { ok: true, requested: "all", explicit: true });
  if (!mistaken.ok) throw Error("Expected explicit all selector.");
  assert.equal(decideEntityAccess({ ...grants, requested: mistaken.requested }).ok, false);

  const route = readFileSync("src/app/api/hcm/salary-corrections/cases/route.ts", "utf8");
  const get = route.split("export async function GET(request: Request) {")[1]
    ?.split("async function guardMutation")[0] ?? "";
  assert.match(get, /resolveMultiEntityContext\(\{\s*userId: user\.id, organizationId, request,\s*\}\)/);
  assert.doesNotMatch(get, /requested:\s*new URL/);
});

test("explicit employer selectors stay enforced and contradictory/duplicate selectors fail closed", () => {
  const own = resolveExplicitEntitySelection({ queryValues: ["101"], header: "101" });
  assert.deepEqual(own, { ok: true, requested: 101, explicit: true });
  if (!own.ok) throw Error("Expected own selector.");
  assert.equal(decideEntityAccess({ ...grants, requested: own.requested }).ok, true);

  const foreign = resolveExplicitEntitySelection({ queryValues: ["102"] });
  assert.deepEqual(foreign, { ok: true, requested: 102, explicit: true });
  if (!foreign.ok) throw Error("Expected foreign selector to parse.");
  assert.equal(decideEntityAccess({ ...grants, requested: foreign.requested }).ok, false);

  assert.deepEqual(resolveExplicitEntitySelection({ queryValues: ["101", "101"] }),
    { ok: false, code: "ENTITY_SELECTOR_INVALID" });
  assert.deepEqual(resolveExplicitEntitySelection({ header: "101", queryValues: ["102"] }),
    { ok: false, code: "ENTITY_SELECTOR_CONFLICT" });
});
