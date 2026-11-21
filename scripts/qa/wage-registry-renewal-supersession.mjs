/** #2003: source-exact revocation of #2005's 75 previously renewed methods.
 * The saved PG16 receipt is authentic but applies ONLY to the former engine.
 * This reviewer awards ZERO credits and cannot be used to repin an old job.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {readWageRenewalInventory} from "./wage-registry-renewal-plan.mjs";
import {
  WAGE_RENEWAL_RECEIPT, WAGE_RENEWAL_RECEIPT_BLOB,
  WAGE_RENEWAL_KIND, wageRenewalRow, validateWageReceiptResults,
} from "./wage-registry-renewal-verify.mjs";
import {wageRenewalV2HoldView} from "./wage-registry-renewal-v2.mjs";

export const PRIOR_ENGINE_BLOB = "dc5719a2c34094b5449bf4ecacb198ab0d74a313";
// #2013 composes the reviewed provider-switch correction with #2003. This
// extends only the zero-credit withdrawal, never the old executed receipt.
// Golden Phase 37 adds the pay-revision correction (a cutoff that ends before a later raise pays the rate in force then).
export const CURRENT_ENGINE_BLOB = "65585916114e1946c0d43651a3ab40e1db2369bd";
export const IMPORTED_BENEFIT_PRIOR_BLOB = "11f6aedd490072a4e1858c95856b7e1c5b43baf7";
const blob = raw => {
  const data = Buffer.from(raw);
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
};
const method = (manifest, e) => manifest.allApiRouteFiles[e.path]?.methods.find(row => row.name === e.verb);

function originalProof(read = readFileSync) {
  const raw = read(WAGE_RENEWAL_RECEIPT);
  assert.equal(blob(raw), WAGE_RENEWAL_RECEIPT_BLOB, "Historical #2005 source receipt cannot change");
  const receipt = JSON.parse(raw);
  validateWageReceiptResults(receipt);
  assert.equal(receipt.sourcePins["src/lib/payroll-engine.ts"], PRIOR_ENGINE_BLOB);
  assert.equal(blob(read("src/lib/payroll-engine.ts")), CURRENT_ENGINE_BLOB,
    "Unknown payroll-engine source: regenerate review evidence before changing credits");
  assert.equal(blob(read("src/lib/imported-benefit-prior.ts")), IMPORTED_BENEFIT_PRIOR_BLOB,
    "Unknown imported-benefit prior source: review zero-credit withdrawal again");
  const inventory = readWageRenewalInventory(read);
  assert.equal(inventory.methods.length, 75);
  assert.equal(receipt.methods.length, 75);
  return {inventory, receipt};
}

export function verifyWageRenewalEngineWithdrawal(manifest, read = readFileSync) {
  // A v2 per-method renewal re-credits these methods from fresh execution; project it back to the exact hold first.
  manifest = wageRenewalV2HoldView(manifest, read);
  const {inventory} = originalProof(read);
  const keys = new Set();
  for (const entry of inventory.methods) {
    assert.equal(manifest.allApiRouteFiles[entry.path]?.gitBlobSha, entry.routeBlobSha);
    assert.deepEqual(method(manifest, entry), entry.held,
      "Stale renewal must be fully withdrawn: " + entry.verb + " " + entry.path);
    keys.add(entry.verb + " " + entry.path);
  }
  assert.equal(keys.size, 75);
  return keys;
}

/** Permit ONLY exact prior #2005 CURRENT->GAP demotions, no arbitrary regression. */
/** Historical zero-credit projection for legacy guard comparisons ONLY.
 * Never use this as a current manifest or to assert live method coverage. */
export function historicalWageHoldProjection(before, read = readFileSync) {
  before = wageRenewalV2HoldView(before, read);
  const {inventory, receipt} = originalProof(read);
  const view = structuredClone(before);
  let withdrawn = 0;
  for (const entry of inventory.methods) {
    const old = method(before, entry);
    if (old?.testedBy?.kind !== WAGE_RENEWAL_KIND) {
      assert.deepEqual(old, entry.held, "Old row must remain a source-exact hold");
      continue;
    }
    assert.deepEqual(old, wageRenewalRow(entry, receipt), "Old executed source receipt was altered");
    const rows = view.allApiRouteFiles[entry.path].methods;
    rows[rows.findIndex(row => row.name === entry.verb)] = structuredClone(entry.held);
    withdrawn++;
  }
  view.metrics.coveredAfter -= withdrawn;
  view.metrics.gap += withdrawn;
  view.acceptanceStatus = view.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,
    "NOT ACCEPTED: " + view.metrics.gap + " API methods");
  return view;
}

export function reviewedWageRenewalEngineWithdrawal(before, after, read = readFileSync) {
  const previous = Object.values(before.allApiRouteFiles).flatMap(file => file.methods)
    .filter(row => row.testedBy?.kind === WAGE_RENEWAL_KIND);
  if (!previous.length) return new Set();
  assert.equal(previous.length, 75, "Partial #2005 renewal cannot be withdrawn");
  const {inventory, receipt} = originalProof(read);
  const keys = verifyWageRenewalEngineWithdrawal(after, read);
  for (const entry of inventory.methods) {
    assert.deepEqual(method(before, entry), wageRenewalRow(entry, receipt),
      "Only exactly sealed #2005 renewals may be withdrawn: " + entry.verb + " " + entry.path);
    assert.equal(before.allApiRouteFiles[entry.path].gitBlobSha,
      after.allApiRouteFiles[entry.path].gitBlobSha);
  }
  return keys;
}
