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

test("only receipt-backed webhook methods are COVERED and the rule counts them", () => {
  const receipts = {
    "webhooks/xendit-payout": "scripts/qa/tenant-webhook-xendit-payout-http.mjs",
    "webhooks/paymongo/transfers": "scripts/qa/tenant-webhook-paymongo-transfer-http.mjs",
    "webhooks/resend": "scripts/qa/tenant-webhook-resend-http.mjs",
  };
  let covered = 0;
  for (const route of credited) {
    const entry = Object.values(manifest.allApiRouteFiles).find(item => item.route === route);
    assert.ok(entry, route + " must remain in the manifest");
    for (const method of entry.methods) {
      if (method.status !== "COVERED") continue;
      covered += 1;
      assert.equal(method.testedBy?.file, receipts[route], route + " " + method.name + " needs its own executed receipt");
      assert.equal(method.testedBy.rule, "proofPolicy.providerCallback");
      assert.equal(method.testedBy.independentSecurityReview, "PENDING");
    }
  }
  assert.equal(rule.creditedMethods, covered, "the rule's counter must match the credited methods");
});

test("the documented retry refusal is one narrow, evidence-bound exception and 503 still never counts elsewhere", () => {
  const exception = rule.documentedRetryRefusal;
  assert.ok(exception && typeof exception === "object", "the exception must be explicit");
  assert.deepEqual(Object.keys(rule).filter(key => key.toLowerCase().includes("refusal")), ["documentedRetryRefusal"], "only one exception key may exist");
  assert.equal(exception.appliesTo, "webhooks/xendit/subscriptions POST only.");
  assert.equal(exception.status, 503);
  assert.deepEqual(exception.body, { error: "Subscription is not reconciled yet." });
  assert.ok(rule.neverCounts.includes("503"), "neverCounts must keep 503: the exception adds a bounded carve-out, it does not remove the rule");
  assert.ok(exception.countsOnlyAs.includes("never as own evidence") && exception.countsOnlyAs.includes("disabled, missing-secret or authentication"));
  assert.equal(exception.requires.length, 4);
  for (const part of ["real own paid cycle", "byte-identical", "unchanged", "forged organization, subscription and legal-entity selectors"]) {
    assert.ok(exception.requires.some(text => text.includes(part)), "exception must require: " + part);
  }
  assert.ok(exception.review.includes("PENDING"));
  // The route must still answer exactly that body, and the harness must still assert every required part.
  const route = readFileSync("src/app/api/webhooks/xendit/subscriptions/route.ts", "utf8");
  assert.ok(route.includes('{ error: "Subscription is not reconciled yet." }, { status: 503 }'));
  const harness = readFileSync("scripts/qa/tenant-webhook-xendit-subscriptions-http.mjs", "utf8");
  for (const token of ['"A own paid cycle"', '"B own paid cycle"', '"same event replay"', "concurrent duplicates must not double-write",
    "a real foreign pair must not be distinguishable from a nonexistent pair", '"forged selectors ignored"']) {
    assert.ok(harness.includes(token), "harness must still contain: " + token);
  }
  assert.ok(harness.includes("assert.equal(refused.status, 503"));
});
