import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const rule = manifest.proofPolicy.providerCallback;
const credited = ["webhooks/xendit-payout", "webhooks/paymongo/transfers", "webhooks/xendit/subscriptions", "webhooks/resend"];

test("the provider callback rule is explicit, narrow and leaves the session rule untouched", () => {
  assert.ok(rule && typeof rule === "object", "proofPolicy.providerCallback must exist");
  for (const key of ["appliesTo", "own", "foreign", "forgedSelector", "replayAndRace", "neverCounts", "environment", "review"]) {
    assert.equal(typeof rule[key], "string", key);
    assert.ok(rule[key].length > 40, key + " must be a real sentence, not a stub");
  }
  for (const route of credited) assert.ok(rule.appliesTo.includes(route), "rule must name " + route);
  assert.ok(rule.appliesTo.includes("webhooks/drain is worker-token-only"), "drain stays under the global-worker rule");
  assert.ok(rule.foreign.includes("greater than every attacker-owned object"), "victim id must exceed attacker ids");
  assert.ok(rule.foreign.includes("not an existence oracle"), "an ignore response must not reveal object existence");
  assert.ok(rule.foreign.includes("never bypassed"), "signature or token verification must be the route's own");
  assert.ok(rule.neverCounts.includes("401") && rule.neverCounts.includes("503"), "auth and config failures never count");
  assert.ok(rule.environment.includes("no provider HTTP"), "no provider traffic");
  assert.ok(rule.review.includes("PENDING"), "independent review stays pending");
  assert.ok(manifest.proofPolicy.covered.includes("Never infer from invented IDs"), "the session COVERED rule must not be weakened");
});

test("no webhook method is credited by the rule PR itself", () => {
  assert.equal(rule.creditedMethods, 0);
  for (const route of credited) {
    const entry = Object.values(manifest.allApiRouteFiles).find(item => item.route === route);
    assert.ok(entry, route + " must remain in the manifest");
    for (const method of entry.methods) assert.notEqual(method.status, "COVERED", route + " " + method.name + " needs a proof PR first");
  }
});
