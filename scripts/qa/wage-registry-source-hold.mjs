/**
 * Wage-order dependency changes invalidate historical, source-sealed tenant
 * receipts. This guard verifies a zero-credit withdrawal only; it cannot renew
 * a method, bypass a denial, or certify payroll, providers or production.
 * Reproof requires fresh, independently reviewed real-HTTP source closures.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {historicTransitiveWageProofView} from "./wage-registry-transitive-source-hold.mjs";
import {historicSealedWageProofView} from "./wage-registry-sealed-receipt-source-hold.mjs";

export const WAGE_PROOF_SOURCE = "src/lib/wage-orders.ts";
export const WATCH_PROOF_SOURCE = "src/lib/statutory-rule-watch.ts";
export const PRIOR_WAGE_BLOB_SHA = "2ea37036211a846ff515540d6b982760df8db1eb";
export const NEW_WAGE_BLOB_SHA = "0bb8c55d6cad0f3a22f6096f0937dd55ca0b227d";
export const PRIOR_WATCH_BLOB_SHA = "0393d836eeee5874a85df4ba571bc4456f47a4ef";
export const NEW_WATCH_BLOB_SHA = "0032da010a8065d415415d50f0353a7a430e12fb";
export const PRIOR_PAYROLL_RECEIPT_SHA256 = "4d5c0aed6da12760c9fba7e97bbce51bd28af0de09a507943d12ea7783f131a9";

const affected = [
  ["src/app/api/compliance/validate/route.ts", ["POST"]],
  ["src/app/api/employees/route.ts", ["GET", "POST", "PATCH"]],
  ["src/app/api/payroll-runs/route.ts", ["GET", "POST"]],
  ["src/app/api/payroll-runs/[id]/assurance/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/close/route.ts", ["GET", "POST"]],
  ["src/app/api/payroll-runs/[id]/connected-impact/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/explain/[employeeId]/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/exports/route.ts", ["GET", "POST"]],
  ["src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", ["GET", "POST"]],
  ["src/app/api/payroll-runs/[id]/pilot-signoff/route.ts", ["POST"]],
  ["src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/process/route.ts", ["POST"]],
  ["src/app/api/payroll-runs/[id]/release-checklist/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/release/route.ts", ["POST"]],
  ["src/app/api/payroll-runs/[id]/submit-review/route.ts", ["POST"]],
  ["src/app/api/payroll-runs/[id]/variance/route.ts", ["GET"]],
  ["src/app/api/payroll-runs/[id]/xendit-payout/route.ts", ["GET"]],
];
export const WAGE_SOURCE_HELD_METHODS = Object.freeze(affected.flatMap(
  ([path, verbs]) => verbs.map(verb => path + " " + verb)
));

function gitBlob(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex");
}

export function verifyWageRegistrySourceHold(manifest, path, verb, read = readFileSync) {
  if (!WAGE_SOURCE_HELD_METHODS.includes(path + " " + verb)) return false;
  const row = manifest.allApiRouteFiles?.[path]?.methods.find(method => method.name === verb);
  if (row?.status !== "GAP" || row.reviewedUncertified?.kind !== "wage-registry-dependency-source-withdrawal") return false;
  const hold = row.reviewedUncertified;
  assert.equal(row.testedBy, null, "Old credit must be withdrawn, not simultaneously active");
  assert.equal(hold.coverageCredits, 0);
  assert.equal(hold.execution, "NOT_RUN");
  assert.equal(hold.independentSecurityReview, "PENDING");
  assert.equal(hold.productionCertified, false);
  assert.equal(hold.sourceBefore, PRIOR_WAGE_BLOB_SHA);
  assert.equal(hold.sourceAfter, NEW_WAGE_BLOB_SHA);
  assert.equal(hold.watchBefore, PRIOR_WATCH_BLOB_SHA);
  assert.equal(hold.watchAfter, NEW_WATCH_BLOB_SHA);
  assert.equal(gitBlob(read(WAGE_PROOF_SOURCE)), NEW_WAGE_BLOB_SHA,
    "Wage registry changed again: prior holds do not transfer to new source bytes");
  assert.equal(gitBlob(read(WATCH_PROOF_SOURCE)), NEW_WATCH_BLOB_SHA,
    "Statutory watch changed again: source closure requires fresh review");
  assert.ok(hold.priorProof && typeof hold.priorProof === "object");
  if (path.startsWith("src/app/api/payroll-runs/")) {
    assert.equal(hold.priorProof.kind, "payroll-run-source-renewal-real-http-pg16");
    assert.equal(hold.priorProof.receiptSha256, PRIOR_PAYROLL_RECEIPT_SHA256);
    assert.equal(hold.priorProof.routeBlobSha, manifest.allApiRouteFiles[path].gitBlobSha);
    assert.ok(row.historicalOracleSourceWithdrawal,
      "Original membership-oracle withdrawal must remain immutable history");
  } else {
    assert.match(hold.priorProof.file, /^scripts\/qa\/[^/]+\.mjs$/);
  }
  return true;
}

export function verifyAllWageRegistrySourceHolds(manifest, read = readFileSync) {
  const seen = [];
  for (const key of WAGE_SOURCE_HELD_METHODS) {
    const at = key.lastIndexOf(" "), path = key.slice(0, at), verb = key.slice(at + 1);
    assert.ok(verifyWageRegistrySourceHold(manifest, path, verb, read),
      "Every affected old proof must be explicitly HELD and source-pinned: " + key);
    seen.push(key);
  }
  assert.equal(seen.length, 23);
  return seen;
}

/**
 * Validation-only historical ledger projection for legacy source-sealed
 * page/SSO verifiers. The live manifest is NEVER changed or re-credited.
 * Exactly 23 source-pinned, zero-credit holds must verify first. This view
 * explains past receipts; it does not approve the changed wage dependency.
 */
export function historicWageRegistryProofView(manifest, read = readFileSync) {
  const currentRows = Object.values(manifest.allApiRouteFiles ?? {}).flatMap(file => file.methods);
  const heldRows = currentRows.filter(row =>
    row.reviewedUncertified?.kind === "wage-registry-dependency-source-withdrawal");
  if (heldRows.length === 0) return historicSealedWageProofView(historicTransitiveWageProofView(manifest, read), read);
  assert.equal(heldRows.length, WAGE_SOURCE_HELD_METHODS.length,
    "Partial or extra wage source holds are forbidden in historical view");
  verifyAllWageRegistrySourceHolds(manifest, read);
  assert.equal(manifest.metrics.methods, currentRows.length);
  assert.equal(manifest.metrics.gap, currentRows.filter(row => row.status === "GAP").length);
  assert.equal(manifest.metrics.coveredAfter, currentRows.filter(row => row.status === "COVERED").length);
  assert.ok(manifest.metrics.gap >= WAGE_SOURCE_HELD_METHODS.length);
  const view = structuredClone(manifest);
  for (const key of WAGE_SOURCE_HELD_METHODS) {
    const at = key.lastIndexOf(" "), path = key.slice(0, at), verb = key.slice(at + 1);
    const row = view.allApiRouteFiles[path].methods.find(method => method.name === verb);
    const priorProof = structuredClone(row.reviewedUncertified.priorProof);
    row.status = "COVERED";
    row.testedBy = priorProof;
    delete row.reviewedUncertified;
    row.reason = "HISTORICAL VIEW ONLY: previous source-bound proof; currently HELD pending fresh independent reproof.";
  }
  view.metrics.gap -= WAGE_SOURCE_HELD_METHODS.length;
  view.metrics.coveredAfter += WAGE_SOURCE_HELD_METHODS.length;
  view.acceptanceStatus = view.acceptanceStatus.replace(
    /^NOT ACCEPTED: \d+ API methods/,
    "NOT ACCEPTED: " + view.metrics.gap + " API methods");
  return historicSealedWageProofView(historicTransitiveWageProofView(view, read), read);
}

/**
 * Only a complete, exact-source, zero-credit withdrawal of old COVERED
 * methods may reduce the tenant ledger. Compare each archived prior proof to
 * the PR base; no unrelated method or source-hash repin is exempt.
 * Return keys in the standard "VERB path" tally format.
 */
export function reviewedWageRegistrySourceWithdrawals(before, after, read = readFileSync) {
  const declared = WAGE_SOURCE_HELD_METHODS.filter(key => {
    const at = key.lastIndexOf(" "), path = key.slice(0, at), verb = key.slice(at + 1);
    return after.allApiRouteFiles?.[path]?.methods.find(x => x.name === verb)
      ?.reviewedUncertified?.kind === "wage-registry-dependency-source-withdrawal";
  });
  if (declared.length === 0) return new Set();
  assert.equal(declared.length, WAGE_SOURCE_HELD_METHODS.length,
    "Partial wage-registry security withdrawal cannot silently downgrade tenant coverage");
  verifyAllWageRegistrySourceHolds(after, read);
  const held = new Set();
  for (const key of declared) {
    const at = key.lastIndexOf(" "), path = key.slice(0, at), verb = key.slice(at + 1);
    const old = before.allApiRouteFiles?.[path];
    const now = after.allApiRouteFiles?.[path];
    const prior = old?.methods.find(x => x.name === verb);
    const current = now?.methods.find(x => x.name === verb);
    assert.equal(old?.gitBlobSha, now?.gitBlobSha,
      "A changed API route needs its own new independent proof: " + key);
    assert.equal(prior?.status, "COVERED", "Only source-credited previous methods may be withdrawn: " + key);
    assert.equal(current?.status, "GAP");
    assert.equal(current.testedBy, null);
    assert.deepEqual(current.reviewedUncertified.priorProof, prior.testedBy,
      "Historical wage dependency proof must exactly match the PR's base");
    held.add(verb + " " + path);
  }
  return held;
}
