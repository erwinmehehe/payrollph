import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyOracleSourceHolds, ORACLE_HELD_METHODS } from "../scripts/qa/payroll-run-oracle-hold.mjs";
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
const read = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
test("only nineteen exact stale source credits may be withdrawn; metrics derive from statuses", () => {
  const m = read(); assert.equal(verifyOracleSourceHolds(m).size, 19);
  assert.equal(ORACLE_HELD_METHODS.length, 19); assertLiveTenantCounts(assert, m);
});
test("forged hold receipts, changed route/helper code and false acceptance are rejected", () => {
  const path = "src/app/api/payroll-runs/[id]/assurance/route.ts";
  for (const patch of [{ coverageCredits: 1 }, { execution: "PASS" }, { productionCertified: true }, { priorProof: {} }, { oldSourceBlobSha: "0".repeat(40) }]) {
    const m = read(); Object.assign(m.allApiRouteFiles[path].methods[0].reviewedUncertified, patch);
    assert.throws(() => verifyOracleSourceHolds(m));
  }
  for (const changed of [path, "src/lib/payroll-run-membership.ts", "scripts/qa/payroll-run-oracle-historical-proofs.json"])
    assert.throws(() => verifyOracleSourceHolds(read(), null, (p, ...args) => p === changed ? readFileSync(p, ...args) + "\n// drift" : readFileSync(p, ...args)));
  const promoted = read(); promoted.allApiRouteFiles[path].methods[0].status = "COVERED";
  assert.throws(() => verifyOracleSourceHolds(promoted), "a stale hold cannot become a method credit");
  const fabricated=read(),row=fabricated.allApiRouteFiles[path].methods[0];
  row.status="COVERED";delete row.reviewedUncertified;row.testedBy={file:"scripts/qa/fabricated.mjs"};
  assert.throws(()=>verifyOracleSourceHolds(fabricated),"removing the hold cannot turn a fake receipt into renewal");
  const erased=read();
  for(const file of Object.values(erased.allApiRouteFiles))for(const method of file.methods)
    if(method.reviewedUncertified?.kind==="payroll-run-membership-oracle-source-withdrawal"){
      method.status="COVERED";delete method.reviewedUncertified;method.testedBy={file:"scripts/qa/fabricated.mjs"};
    }
  assert.throws(()=>verifyOracleSourceHolds(erased),"erasing every hold cannot disable the source-bound verifier");
});
test("an unrelated downgrade remains a hard failure", () => {
  const m = read(), file = m.allApiRouteFiles["src/app/api/employees/route.ts"];
  file.methods.find(row => row.status === "COVERED").status = "GAP";
  m.metrics.coveredAfter--; m.metrics.gap++;
  m.acceptanceStatus = m.acceptanceStatus.replace((m.metrics.gap - 1) + " API methods", m.metrics.gap + " API methods");
  assert.throws(() => assertLiveTenantCounts(assert, m), /downgraded|no proven method/);
});

test("manifest HTTP acceptance distinguishes exact source holds from renewed method credit", () => {
  const source = readFileSync("scripts/qa/tenant-manifest-driven-http.mjs", "utf8");
  assert.match(source, /const sourceWithdrawals = verifyOracleSourceHolds\(manifest\)/);
  assert.match(source, /sourceWithdrawals\.has\("POST src\/app\/api\/payroll-runs\/\[id\]\/close\/route\.ts"\)/);
  assert.match(source, /complete credit renewal still required/);
  assert.match(source, /assert\.equal\(closePost\?\.status, "COVERED"/);
  assert.match(source, /verifyMergedProofCredits\(manifest\)/);
});
