import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { historicalNext16DependencyInput } from "./helpers/historical-next16-dependencies.mjs";
import { readHistoricalSecurityEvidence } from "./helpers/document-security-fixture.mjs";

const blob = bytes => {
  const b = Buffer.from(bytes);
  return createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
};
test("immutable historical Next.js inputs reconstruct exact original package blobs", () => {
  assert.equal(blob(historicalNext16DependencyInput("package.json")), "7078c01f09c85f79dd79ba5517a80e80cdb72ae3");
  assert.equal(blob(historicalNext16DependencyInput("package-lock.json")), "49a688969f37bd3fd690d313970221ff2d5f7fc2");
  assert.equal(blob(readFileSync("package.json")), "d327bc82bcedc19d76a91860a59c2270c4b12434");
  assert.equal(blob(readFileSync("package-lock.json")), "e6a6ef7e48346838ed16052288acef4d87dcc375");
});
test("current framework drift or modified historical fixture is rejected, not silently recredited", () => {
  for (const path of ["package.json", "package-lock.json"]) {
    const changed = name => name === path ? Buffer.from("unreviewed dependency drift") : readFileSync(name);
    assert.throws(() => historicalNext16DependencyInput(path, changed), /exact reviewed 16.4.6 upgrade/);
    const badFixture = name => name.endsWith("tenant-next-16-4-2-lock-delta.json")
      ? Buffer.from("tampered historical fixture") : readFileSync(name);
    assert.throws(() => historicalNext16DependencyInput(path, badFixture), /Historical dependency delta fixture changed/);
  }
});
test("old security-write receipt remains historical, without claiming an upgraded-run credit", () => {
  const receipt = readHistoricalSecurityEvidence();
  assert.equal(receipt.productionCertified, false);
  assert.equal(receipt.independentlyAccepted, false);
  assert.equal(receipt.targets.length, 3);
  assert.equal(receipt.runs.developer.coverageCredits, 0);
});
