import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTenantResourceId } from "../src/lib/canonical-tenant-resource-id";

test("only canonical positive safe integer resource IDs are accepted", () => {
  for (const id of [1, 23, 901, Number.MAX_SAFE_INTEGER]) {
    assert.equal(canonicalTenantResourceId(String(id)), id);
  }
});

test("malformed or ambiguous payroll run selectors never coerce", () => {
  for (const bad of [
    null, undefined, 1, ["1"], ["1", "2"], "", "0", "-1", "+1", "01",
    "1e2", "1.0", "1.5", "1 ", " 1", "\t1", "NaN", "Infinity",
    "9007199254740992", "99999999999999999999999", "0x10", "1,2",
  ]) assert.equal(canonicalTenantResourceId(bad), null, String(bad));
});
