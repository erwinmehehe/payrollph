/**
 * Exact-source, CI-only HCM release embargo shim for disposable Worker 360
 * legal-employer HTTP proof. NEVER commit the modified runtime module.
 * The source is restored byte-for-byte after Next is compiled.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {requireIsolatedWorker360} from "./tenant-hcm-worker360-entity-contract.mjs";

export const HOLD_PATH = "src/lib/multi-entity-hcm-hold.ts";
export const HOLD_BLOB_SHA = "3b05a6ca3cf157513d37a55ccb3bf2f8002579cc";
const ORIGINAL = '  if (!multiEntityHcmDeferred(env)) return false;';
const CI_ONLY = [
  ORIGINAL,
  '  // Ephemeral CI-compiled Worker 360 proof only; production embargo restored.',
  '  if ((pathname === "/api/hcm/worker-360" || pathname === "/hcm/worker-360") &&',
  '      method === "GET" &&',
  '      env.TENANT_WORKER360_ENTITY_PROOF === "fictional-pg16-only" &&',
  '      env.CI === "true" && env.GITHUB_ACTIONS === "true" &&',
  '      env.NODE_ENV === "production" &&',
  '      env.BUILD_BLOCK_ACCEPTANCE_MODE === "synthetic-postgres-only" &&',
  '      env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&',
  '      env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&',
  '      env.MULTI_ENTITY_ENABLED === "true" && env.HCM_WORKER_360_ENABLED === "true" &&',
  '      env.DEMO_MODE === "false" && env.WORKER_ENABLED === "false" &&',
  '      env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&',
  '      env.XENDIT_PAYOUTS_ENABLED === "false" && env.XENDIT_BILLING_ENABLED === "false" &&',
  '      !env.NEON_DATABASE_URL && !env.OPENAI_API_KEY && !env.XENDIT_SECRET_KEY &&',
  '      !env.PAYMONGO_SECRET_KEY && !env.STRIPE_SECRET_KEY &&',
  '      !env.RESEND_API_KEY && !env.POSTMARK_SERVER_TOKEN && !env.SMTP_PASSWORD)',
  '    return false;',
].join("\n");

export function blob(source) {
  const bytes=Buffer.isBuffer(source)?source:Buffer.from(source);
  return createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0"))
    .update(bytes).digest("hex");
}
export function applyIsolatedShim(source) {
  assert.equal(blob(source),HOLD_BLOB_SHA,
    "WORKER360_ENTITY_REFUSED: original production embargo changed");
  assert.equal(source.split(ORIGINAL).length,2,
    "WORKER360_ENTITY_REFUSED: expected exactly one HCM embargo branch");
  return source.replace(ORIGINAL,CI_ONLY);
}
export function restoreProductionHold(source) {
  assert.equal(source.split(CI_ONLY).length,2,
    "WORKER360_ENTITY_REFUSED: synthetic hold source changed");
  const original=source.replace(CI_ONLY,ORIGINAL);
  assert.equal(blob(original),HOLD_BLOB_SHA,
    "WORKER360_ENTITY_REFUSED: cannot restore original embargo exactly");
  return original;
}
function cli() {
  const mode=process.argv[2];
  assert.ok(["apply","restore","verify"].includes(mode),
    "WORKER360_ENTITY_REFUSED: expected apply, restore or verify");
  requireIsolatedWorker360();
  const path=resolve(HOLD_PATH),content=readFileSync(path,"utf8");
  if (mode==="apply") {
    writeFileSync(path,applyIsolatedShim(content));
    console.log("WORKER360_CI_ONLY: isolated localhost HCM path compiled; production hold not changed in Git");
  } else if (mode==="restore") {
    writeFileSync(path,restoreProductionHold(content));
    assert.equal(blob(readFileSync(path)),HOLD_BLOB_SHA);
    console.log("WORKER360_CI_ONLY: original multi-entity HCM embargo restored byte-for-byte");
  } else {
    assert.equal(blob(content),HOLD_BLOB_SHA);
    assert.ok(content.includes("return !isolatedSalaryPreviewProof;"),
      "WORKER360_ENTITY_REFUSED: production HCM embargo must remain");
    console.log("WORKER360_CI_ONLY: original HCM embargo verified");
  }
}
if (process.argv[1]?.replaceAll("\\","/")
    .endsWith("/tenant-hcm-worker360-entity-build-hold.mjs"))
  try {cli()}catch(error){console.error(error);process.exitCode=1}
