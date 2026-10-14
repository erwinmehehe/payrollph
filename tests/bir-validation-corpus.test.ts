import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildSyntheticValidationCorpus, syntheticFilingInput } from "../scripts/qa/bir-1604c-validation-corpus";
import { buildBir1604cDatCandidate } from "../src/lib/bir-1604c-dat-candidate";

test("filing corpus binds deterministic bytes to source; never claims official validation", () => {
  const pack = buildSyntheticValidationCorpus("a".repeat(40));
  assert.deepEqual(pack, buildSyntheticValidationCorpus("a".repeat(40)));
  assert.equal(pack.manifest.officialValidatorResult, "NOT_RUN");
  assert.equal(pack.manifest.agencySubmission, "PROHIBITED");
  assert.equal(pack.files.length, 5);
  assert.equal(new Set(pack.files.map(f => f.sha256)).size, 5);
  for (const f of pack.files) {
    assert.equal(createHash("sha256").update(f.content, "ascii").digest("hex"), f.sha256);
    assert.notEqual(createHash("sha256").update(f.content + " ", "ascii").digest("hex"), f.sha256);
  }
  assert.throws(() => buildSyntheticValidationCorpus("local"), /Exact source/);
});

test("annual released withholding reconciles to the exact centavo in both directions", () => {
  const input = syntheticFilingInput();
  assert.equal(buildBir1604cDatCandidate(input).recordCount, 5);
  for (const expectedActualWithheld of ["194999.99", "195000.01"])
    assert.throws(() => buildBir1604cDatCandidate({ ...input, expectedActualWithheld }), /does not reconcile/);
});

test("bad identity, duplicate, date, encoding, population and employer input fail closed", () => {
  const modifications = [
    (i: ReturnType<typeof syntheticFilingInput>) => { i.records[0].fields.TIN = "123"; },
    (i: ReturnType<typeof syntheticFilingInput>) => { i.records[1].fields.TIN = i.records[0].fields.TIN; },
    (i: ReturnType<typeof syntheticFilingInput>) => { i.records[0].fields.EMPLOYMENT_FROM = "02/30/2025"; },
    (i: ReturnType<typeof syntheticFilingInput>) => { i.records[0].fields.LAST_NAME = "FAKE\nROW"; },
    (i: ReturnType<typeof syntheticFilingInput>) => { i.expectedEmployees++; },
    (i: ReturnType<typeof syntheticFilingInput>) => { i.records[0].fields.TIN_EMPYR = "987654321"; },
    (i: ReturnType<typeof syntheticFilingInput>) => { delete i.records[0].fields.PREV_TAX_WTHLD; },
  ];
  for (const modify of modifications) {
    const input = syntheticFilingInput(); modify(input);
    assert.throws(() => buildBir1604cDatCandidate(input));
  }
});
