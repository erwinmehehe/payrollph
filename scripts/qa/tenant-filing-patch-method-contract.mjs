/**
 * Full PATCH method recovery candidate: one exact source, three independent
 * disposable PG16 HTTP legs. This file is assertions only: no DB import.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireDisposableFilingEnv } from "./tenant-filing-outcome-contract.mjs";

export const METHOD = "PATCH /api/compliance/filing-validations/[id]";
export const MODES = Object.freeze(["accepted", "rejected", "guards"]);
export const ORIGIN = "http://127.0.0.1:3000";
export const SOURCE_PINS = Object.freeze({
  "src/app/api/compliance/filing-validations/[id]/route.ts": "09f642a67035dc9ce22fa502d80518ba18641b0f",
  "src/lib/filing-evidence-store.ts": "ae9b8e3f048e24b23fb35e4c9cd2334c2e44819f",
  "src/lib/filing-evidence.ts": "85cc9ecc86daa9ab18bd6dfb08878dab32b46180",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "scripts/qa/tenant-compliance-accepted-http.mjs": "796a593c8eea153d45baea804fdde225ccb7c95b",
  "scripts/qa/tenant-filing-outcome-http.mjs": "4cab7b09aca3c82259444b47d6fa6d33017c9544",
  "scripts/qa/tenant-filing-outcome-contract.mjs": "646616813fc04e7a3762ef4471a0f5739e91f14c",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/disposable-insert-veto.mjs": "ed957b356e8a837076b97ccf82251e22b06bea65",
  "scripts/qa/tenant-table-env.mjs": "05dcdcdbd513b0e257b6aefb5d9449117224b357",
});

export function gitBlobSha(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
}

export function requireFilingPatchRecoveryEnv(env = process.env) {
  requireDisposableFilingEnv(env);
  assert.equal(env.TENANT_FILING_PATCH_RECOVERY, "fictional-only",
    "FILING_PATCH_REFUSED: independent fictional-only recovery mode required");
  assert.equal(env.TENANT_TABLE_PROFILE, "compliance-posts",
    "FILING_PATCH_REFUSED: reviewed compliance-posts profile required");
  assert.equal(env.MULTI_ENTITY_ENABLED, "false",
    "FILING_PATCH_REFUSED: multi-entity must be off");
  for (const [key, expected] of Object.entries({
    XENDIT_BILLING_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false",
    WORKER_ENABLED: "false",
    CENTRAL_SCHEDULER_ENABLED: "false",
    "TENANT_FILING_OUTCOME_MODE": "fictional-pg16-filing-outcome",
  })) {
    assert.equal(env[key], expected, "FILING_PATCH_REFUSED: " + key);
  }
  for (const name of [
    "PAYMONGO_WEBHOOK_SECRET", "XENDIT_CALLBACK_SECRET", "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET", "OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
  ]) assert.ok(!env[name], "FILING_PATCH_REFUSED: external credential " + name);
}

export function assertMethodMode(mode) {
  assert.ok(MODES.includes(mode), "FILING_PATCH_REFUSED: unsupported proof mode");
  return mode;
}

export function verifyFilingPatchSourcePins(read = readFileSync) {
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(read(path)), sha,
      "FILING_PATCH_REFUSED: source drift requires new independent review: " + path);
  }
}

export function assertAcceptedReceipt(row) {
  assert.equal(row.method, METHOD);
  assert.deepEqual(row.acceptedModes, ["manual_entry", "file_upload"]);
  assert.equal(row.independentFictionalEmployers, 2);
  assert.equal(row.higherIdVictim, true);
  assert.equal(row.realOwnAccepted200, 2);
  assert.equal(row.realDenials, 18);
  assert.equal(row.realAuditRollbacks, 2);
  assert.equal(row.crossTenantDbAndAuditImmutable, true);
  assert.equal(row.evidenceSourceReproduced, true);
  assert.equal(row.agencyContacted, false);
  assert.equal(row.actualAcknowledgementVerified, false);
  assert.equal(row.payrollReleasedToRealEmployees, false);
  assert.equal(row.moneyMoved, false);
  assert.equal(row.coverageCredits, 0);
  assert.equal(row.independentlyAccepted, false);
  return row;
}

export function assertRejectedReceipt(row) {
  assert.equal(row.kind, "fictional-compliance-filing-outcome-tenant-proof");
  assert.equal(row.method, METHOD);
  assert.equal(row.attackerEmployers, 2);
  assert.equal(row.higherIdVictimEmployers, 1);
  assert.equal(row.ownPersistedRejections, 2);
  assert.equal(row.tenantAndInputDenials, 16);
  assert.equal(row.foreignEqualsNonexistent, 2);
  assert.equal(row.actualAuditVetoRollbacks, 2);
  assert.equal(row.officialFilingAcceptanceProven, false);
  assert.equal(row.submittedToAgency, false);
  assert.equal(row.moneyMoved, false);
  assert.equal(row.coverageCredits, 0);
  assert.equal(row.independentSecurityReview, "PENDING");
  assert.equal(row.productionTested, false);
  return row;
}

export function parseLegacyReceipt(mode, stdout) {
  assert.ok(mode === "accepted" || mode === "rejected",
    "Only previously reviewed positive and rejection runners have receipts");
  assert.equal(typeof stdout, "string");
  const marker = "TENANT_COMPLIANCE_ACCEPTED_HTTP_PASS ";
  if (mode === "accepted") {
    const lines = stdout.split(/\r?\n/).filter(x => x.startsWith(marker));
    assert.equal(lines.length, 1, "FILING_PATCH_REFUSED: exact one accepted receipt required");
    return assertAcceptedReceipt(JSON.parse(lines[0].slice(marker.length)));
  }
  const prefix = '{\n  "kind": "fictional-compliance-filing-outcome-tenant-proof"';
  const offset = stdout.lastIndexOf(prefix);
  assert.ok(offset !== -1, "FILING_PATCH_REFUSED: actual rejection runner receipt required");
  const row = JSON.parse(stdout.slice(offset).trim());
  return assertRejectedReceipt(row);
}

export function assertNoForeignMarkers(response, markers, context) {
  const surface = String(response.text ?? "") + "\n" +
    [...(response.headers ?? [])].map(([name, value]) => name + ":" + value).join("\n");
  for (const marker of markers) {
    assert.ok(marker.length >= 8 && !surface.includes(marker),
      context + ": confidential foreign filing marker leaked");
  }
}

export function assertBoundedDenial(response, code, markers, context) {
  assert.equal(response.status, code, context + ": must return exact HTTP denial");
  assert.ok(response.json && typeof response.json.error === "string" && response.json.error,
    context + ": expected bounded error response");
  assert.equal(response.json.record, undefined, context + ": denied row cannot leak");
  assertNoForeignMarkers(response, markers, context);
}
