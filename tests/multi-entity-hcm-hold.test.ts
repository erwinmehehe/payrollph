import assert from "node:assert/strict";
import test from "node:test";
import { multiEntityHcmDeferred } from "../src/lib/multi-entity-hcm-hold";

test("HCM multi-entity freeze is exact-true only; feature-OFF parity", () => {
  for (const value of [undefined, "", "TRUE", "True", "false", "1", " true "]) {
    assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: value }), false);
  }
  assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: "true" }), true);
});
