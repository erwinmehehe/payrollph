import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertOracleCallerCompatible, originalOracleCallerSource, verifyOracleRegressionReceipt } from "../scripts/qa/payroll-run-oracle-source-compat.mjs";
const edits = JSON.parse(readFileSync("scripts/qa/payroll-run-oracle-caller-edits.json", "utf8"));
const receipt = JSON.parse(readFileSync("scripts/qa/payroll-run-oracle-regression-receipt.json", "utf8"));
const blob = s => createHash("sha1").update("blob " + Buffer.byteLength(s) + "\0" + s).digest("hex");

test("passing PG16 regression and exact reviewed caller reconstruction grant zero method credits", () => {
  assert.equal(verifyOracleRegressionReceipt().result.coverageCredits, 0);
  for (const [path, record] of Object.entries(edits.callers)) {
    assert.equal(blob(originalOracleCallerSource(path)), record.historicalBlob);
    assertOracleCallerCompatible(path, record.historicalBlob);
    assert.throws(() => assertOracleCallerCompatible(path, "0".repeat(40)));
  }
  assert.throws(() => originalOracleCallerSource("scripts/qa/tenant-table-http.mjs"));
});

test("every runtime, proof, workflow, receipt and caller edit input rejects unreviewed drift", () => {
  for (const path of [...Object.keys(receipt.sourceBlobs), ...Object.keys(edits.callers),
    "scripts/qa/payroll-run-oracle-regression-receipt.json", "scripts/qa/payroll-run-oracle-caller-edits.json"]) {
    const read = (p, ...args) => p === path ? String(readFileSync(p, ...args)) + "\n// mutation\n" : readFileSync(p, ...args);
    const caller = Object.hasOwn(edits.callers, path) ? path : "scripts/qa/tenant-money-lifecycle-http.mjs";
    assert.throws(() => originalOracleCallerSource(caller, read), undefined, path);
  }
});
