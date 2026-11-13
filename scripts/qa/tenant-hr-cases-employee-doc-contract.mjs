/** HR case employee POST + COE bytes + hydrated staff browser: zero-credit PG16 contract. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireDisposableHrPageEnv, verifyHrPageSourcePins } from "./tenant-hr-cases-page-contract.mjs";

export const ORIGIN = "http://127.0.0.1:3000";
export const SOURCE_PINS = Object.freeze({
  "src/app/api/hr-cases/route.ts": "2cd3e59558d6a6ae6946b3a7f0f3685b5ddf7cd1",
  "src/app/api/documents/[id]/route.ts": "0acb38b1396b1e35adf02efd6e033cdd0416e0d0",
  "src/lib/private-document-tenant-lookup.ts": "746c735d3c5475636eb8b37297443305906386e9",
  "src/lib/employee-document-vault.ts": "bb23f8f8d0cba3bd76c22a24644f8bacec73b926",
  "src/components/employee-hr-case-staff-queue.tsx": "6c47e7ef4dcd654b72e293aa0eea54a7ee364591",
  "src/lib/hr-case-queue-read.ts": "791fdf4ff241b288ce8c155748083aa918a770be",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});
function gitBlob(value) {
  const bytes = Buffer.from(value);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
export function verifyHrEmployeeDocPins(read = readFileSync) {
  verifyHrPageSourcePins();
  for (const [path, expected] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlob(read(path)), expected,
      "HR_CASE_EMPLOYEE_DOC_REFUSED: source drift " + path);
}
export function refuseUnsafeHrEmployeeDoc(env = process.env) {
  requireDisposableHrPageEnv(env);
  for (const forbidden of [
    "NEON_DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "R2_BUCKET",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "DOCUMENT_STORAGE_ACCESS_KEY", "DOCUMENT_STORAGE_SECRET_KEY",
  ]) assert.ok(!env[forbidden],
    "HR_CASE_EMPLOYEE_DOC_REFUSED: private provider " + forbidden);
  return true;
}
export function assertOwnedDocument(res, ownText, otherMarkers) {
  assert.equal(res.status, 200, "Actual owned sanitized COE must be HTTP 200");
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/i);
  assert.match(res.headers.get("cache-control") ?? "", /private.*no-store/i);
  assert.equal(res.text, ownText, "Own generated document bytes must match persisted source");
  for (const marker of otherMarkers)
    assert.ok(!res.text.includes(marker), "COE bytes leaked foreign marker");
}
export function assertDeniedPrivate(res, expected, markers, label) {
  assert.equal(res.status, expected, label + ": wrong denial status");
  assert.ok(!res.headers.get("content-type")?.includes("text/plain"),
    label + ": denial must not contain actual text document");
  for (const marker of markers)
    assert.ok(!res.text.includes(marker), label + ": leaked private marker");
}
export function assertUnchanged(before, after, context) {
  assert.deepEqual(after, before, context + ": private business/audit SQL changed");
}
