import assert from "node:assert/strict";
import test from "node:test";
import { compareBir1601cFiling } from "../src/lib/bir-1601c-remittance";
import { postedCentavos } from "../src/lib/remittance-centavos-compare";

test("F-09 posted amounts are exact centavos, not fractional cents or non-finite totals", () => {
  assert.equal(postedCentavos(1234.56), 123456);
  assert.equal(postedCentavos(0.29), 29);
  assert.equal(postedCentavos(-250.01), -25001);
  assert.equal(postedCentavos(0), 0);
  assert.equal(postedCentavos(12.345), null);
  assert.equal(postedCentavos(Number.NaN), null);
  assert.equal(postedCentavos(Number.POSITIVE_INFINITY), null);
  assert.equal(postedCentavos(Number.MAX_SAFE_INTEGER), null);
});

test("F-09 BIR 1601-C filing comparison rejects either one-cent direction", () => {
  const baseline = {
    expectedTaxWithheld: 1000.00,
    expectedEmployeeCount: 2,
    reportedTotal: 1000.00,
    reportedEmployeeCount: 2,
  };
  assert.equal(compareBir1601cFiling(baseline).matched, true);

  for (const reportedTotal of [999.99, 1000.01]) {
    const result = compareBir1601cFiling({ ...baseline, reportedTotal });
    assert.equal(result.totalMatches, false);
    assert.equal(result.matched, false);
    assert.equal(Math.abs(result.totalDifference ?? 0), 0.01);
  }

  const subcent = compareBir1601cFiling({ ...baseline, reportedTotal: 1000.001 });
  assert.equal(subcent.totalMatches, false);
  assert.equal(subcent.matched, false);

  const missing = compareBir1601cFiling({ ...baseline, reportedTotal: null });
  assert.equal(missing.totalMatches, false);
  assert.equal(missing.matched, false);

  const mismatchedPopulation = compareBir1601cFiling({
    ...baseline, reportedEmployeeCount: 1,
  });
  assert.equal(mismatchedPopulation.totalMatches, true);
  assert.equal(mismatchedPopulation.matched, false);

  // Signed year-end tax adjustments can produce negative net withholding.
  assert.equal(compareBir1601cFiling({
    expectedTaxWithheld: -250.01,
    expectedEmployeeCount: 1,
    reportedTotal: -250.01,
    reportedEmployeeCount: 1,
  }).matched, true);
});
