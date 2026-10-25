import assert from "node:assert/strict";
import test from "node:test";
import { multiEntityHcmDeferred } from "../src/lib/multi-entity-hcm-hold";

test("HCM multi-entity freeze is exact-true only; feature-OFF parity", () => {
  for (const value of [undefined, "", "TRUE", "True", "false", "1", " true "]) {
    assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: value }), false);
  }
  assert.equal(multiEntityHcmDeferred({ MULTI_ENTITY_ENABLED: "true" }), true);
});

test("source guard denies every unreviewed HCM API and protected HCM page", async () => {
  const { readFileSync } = await import("node:fs");
  const proxy = readFileSync("src/proxy.ts", "utf8");
  const scheduler = readFileSync("src/lib/scheduler.ts", "utf8");
  assert.match(proxy, /"\/api\/hcm\/:path\*"/);
  assert.match(proxy, /"\/hcm\/:path\*"/);
  assert.match(proxy, /_next\/static/);
  assert.match(proxy, /path\.startsWith\("\/api\/hcm\/"\)/);
  assert.match(proxy, /path\.startsWith\("\/hcm\/"\)/);
  assert.match(proxy, /ENTITY_HCM_DEFERRED/);
  assert.match(scheduler, /const hcmEffectiveChanges = multiEntityHcmDeferred\(\)/);
  assert.match(scheduler, /reason: "ENTITY_HCM_DEFERRED"/);
});
