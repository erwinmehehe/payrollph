import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideEntityAccess } from "../src/lib/multi-entity-policy";
import { resolveExplicitEntitySelection } from "../src/lib/multi-entity-selector-boundary";

test("absent selectors stay absent so a revoked preference can fall back to a current grant", () => {
  assert.deepEqual(resolveExplicitEntitySelection({ header: null, queryValues: [] }),
    { ok: true, requested: undefined, explicit: false });
  assert.deepEqual(resolveExplicitEntitySelection({}),
    { ok: true, requested: undefined, explicit: false });
});

test("the same explicit employer across argument, header and URL is one canonical decision", () => {
  assert.deepEqual(resolveExplicitEntitySelection({
    requested: 11, header: "11", queryValues: ["11"],
  }), { ok: true, requested: 11, explicit: true });
  assert.deepEqual(resolveExplicitEntitySelection({
    header: null, queryValues: ["22"],
  }), { ok: true, requested: 22, explicit: true });
  assert.deepEqual(resolveExplicitEntitySelection({
    requested: "all", header: "all", queryValues: ["all"],
  }), { ok: true, requested: "all", explicit: true });
  assert.deepEqual(resolveExplicitEntitySelection({
    requested: null, header: "all",
  }), { ok: true, requested: "all", explicit: true });
});

test("conflicting body/header/query employer selectors never fall through to one allowed employer", () => {
  for (const input of [
    { header: "11", queryValues: ["22"] },
    { requested: 11, header: "22" },
    { requested: 11, queryValues: ["22"] },
    { requested: null, header: "11" },
    { header: "all", queryValues: ["11"] },
    { requested: 22, header: "11", queryValues: ["11"] },
  ]) {
    assert.deepEqual(resolveExplicitEntitySelection(input),
      { ok: false, code: "ENTITY_SELECTOR_CONFLICT" }, JSON.stringify(input));
  }
});

test("malformed and duplicate selectors are rejected, even when one might equal a grant", () => {
  for (const value of ["", " ", "11 ", "+11", "011", "0xB", "1e1",
    "11.0", "0", "-11", "NaN", "Infinity", "9007199254740992",
    0, -11, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    assert.deepEqual(resolveExplicitEntitySelection({ requested: value }),
      { ok: false, code: "ENTITY_SELECTOR_INVALID" }, JSON.stringify(value));
  }
  for (const queryValues of [["11", "22"], ["11", "11"], ["all", "all"]]) {
    assert.deepEqual(resolveExplicitEntitySelection({ queryValues }),
      { ok: false, code: "ENTITY_SELECTOR_INVALID" });
  }
  assert.deepEqual(resolveExplicitEntitySelection({ header: "", queryValues: ["11"] }),
    { ok: false, code: "ENTITY_SELECTOR_INVALID" });
});

test("matching selectors are not an authorization grant: role and current employer grants still decide", () => {
  const aligned = resolveExplicitEntitySelection({ requested: 22, header: "22" });
  assert.equal(aligned.ok, true);
  if (!aligned.ok) throw Error("Expected canonical input");
  const policy = { role: "hr", availableEntityIds: [11, 22], grantedEntityIds: [11] };
  assert.equal(decideEntityAccess({ ...policy, requested: aligned.requested }).ok, false);
  assert.equal(decideEntityAccess({
    ...policy, requested: resolveExplicitEntitySelection({ header: "11" }).ok ? 11 : undefined,
  }).ok, true);
});

test("shared resolver rejects contradictory selectors before legal-entity/grant queries; flag OFF stays prior behavior", () => {
  const source = readFileSync("src/lib/multi-entity-server.ts", "utf8");
  const legacy = source.indexOf('if (!criticalReleaseFlagEnabled("multiEntity"))');
  const selectorGuard = source.indexOf("const selectors = resolveExplicitEntitySelection(");
  const databaseMetadata = source.indexOf("const [entities, grants, preference] = await Promise.all(");
  assert.ok(legacy > 0 && selectorGuard > legacy && databaseMetadata > selectorGuard,
    "Deny mismatches before tenant employer metadata access, but only while enabled");
  assert.match(source, /queryValues: new URL\(/);
  assert.match(source, /searchParams\.getAll\("legalEntityId"\)/);
  assert.match(source, /if \(!selectors\.ok\) return \{ ok: false, response:/);
  assert.match(source, /const requested = selectors\.explicit\s*\?/);
  assert.match(source, /if \(!decision\.ok && !selectors\.explicit\)/);
});
