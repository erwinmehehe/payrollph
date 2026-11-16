/**
 * Wage-order dependency changes invalidate historical, source-sealed tenant
 * receipts. This guard verifies a zero-credit withdrawal only; it cannot renew
 * a method, bypass a denial, or certify payroll, providers or production.
 * Reproof requires fresh, independently reviewed real-HTTP source closures.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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
