/** Preserve unrelated historical receipts across ONLY the reviewed payroll-run
 * denial expectation edits. This earns zero credits and does not renew any of
 * the nineteen changed route methods. Their source withdrawals stay mandatory.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RECEIPT = "scripts/qa/payroll-run-oracle-regression-receipt.json";
const EDITS = "scripts/qa/payroll-run-oracle-caller-edits.json";
const digest = text => createHash("sha256").update(text).digest("hex");
const textOf = value => String(value).replaceAll("\r\n", "\n");
const blob = text => createHash("sha1").update("blob " + Buffer.byteLength(text) + "\0" + text).digest("hex");
const CALLERS = new Set([
  "scripts/qa/tenant-money-lifecycle-http.mjs",
  "scripts/qa/tenant-table-rows/read/path-id.mjs",
  "scripts/qa/tenant-second-pass-http.mjs",
  "scripts/qa/tenant-high-risk-01-http.mjs",
  ".github/workflows/multi-entity-browser-qa.yml",
]);

export function verifyOracleRegressionReceipt(read = readFileSync) {
  const raw = textOf(read(RECEIPT));
  assert.equal(digest(raw), "d8c30cae1d13b2603582cceea2d069cefe9aa6eaf6dbf65bfef60a009135cbba", "oracle execution receipt changed");
  const receipt = JSON.parse(raw);
  assert.equal(receipt.sourceHead, "32190c57869706aa70201d5551a68316982f0e6f");
  assert.equal(receipt.run, 43336550655); assert.equal(receipt.job, 131594069195);
  assert.equal(receipt.conclusion, "success");
  assert.deepEqual(receipt.result, {
    methods: 19, comparisons: 76, ownRoleDenials: 38, revokedComparisons: 38,
    ownRegisterPositives: 3, higherIdVictim: true, unchangedVictimSql: true,
    providerCalls: 0, coverageCredits: 0, label: "SOLO_VERIFIED_DEV_RECOVERY", productionCertified: false,
  });
  for (const [path, expected] of Object.entries(receipt.sourceBlobs))
    assert.equal(blob(textOf(read(path))), expected, "oracle executed input changed: " + path);
  return receipt;
}

/** Return the exact original caller source only after verifying the entire new
 * source, exact reviewed edit list, executed boundary regression and complete
 * reconstructed original blob. Never accepts changes to any other caller. */
export function originalOracleCallerSource(path, read = readFileSync) {
  assert.ok(CALLERS.has(path), "unreviewed oracle caller: " + path);
  const raw = textOf(read(EDITS));
  assert.equal(digest(raw), "6d5dee02ec7964f1d366b13a4343509b93d34d8eb5d98c8669813eabfa8a7fe4", "oracle caller edit review changed");
  const reviewed = JSON.parse(raw);
  assert.equal(reviewed.base, "e2999240e5ee2d820841de5e10193ce9cbc39e6a");
  assert.deepEqual(Object.keys(reviewed.callers).sort(), [...CALLERS].sort());
  const record = reviewed.callers[path];
  let source = textOf(read(path));
  // Compose the separate default-OFF SSO expectation with the oracle edits.
  // Both full source hashes and the exact reconstructed intermediate hash are
  // required. This neither changes an HMO assertion nor renews a payroll credit.
  if (path === "scripts/qa/tenant-second-pass-http.mjs" &&
      blob(source) === "1f4c7cf87104d0fdc7d6362310827a7935afeeb1") {
    const held = '        expectStatus(result, key === "POST auth/sso/resolve" && process.env.OIDC_SSO_RUNTIME_MODE !== "enabled" ? 503 : 200, "Public/auth-status or held SSO endpoint " + key);';
    const original = '        expectStatus(result, 200, "Intentionally public/auth-status endpoint " + key);';
    assert.equal(source.split(held).length, 2, "Exactly one reviewed disabled-SSO expectation");
    source = source.replace(held, original);
    assert.equal(blob(source), record.currentBlob, "SSO/oracle composition must reconstruct the sealed intermediate caller");
  }
  // Immutable historical source remains valid without relabeling its execution.
  if (blob(source) === record.historicalBlob) return source;
  assert.equal(blob(source), record.currentBlob, "unreviewed oracle caller revision: " + path);
  verifyOracleRegressionReceipt(read);
  for (const edit of record.edits) {
    assert.equal(source.split(edit.now).length, 2, "oracle caller edit is missing or ambiguous: " + path);
    source = source.replace(edit.now, edit.old);
  }
  assert.equal(blob(source), record.historicalBlob, "original oracle caller did not reconstruct exactly");
  return source;
}

export function assertOracleCallerCompatible(path, expected, read = readFileSync) {
  assert.equal(blob(originalOracleCallerSource(path, read)), expected,
    "different historical caller cannot borrow the oracle regression: " + path);
}
