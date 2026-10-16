import assert from "node:assert/strict";
import test from "node:test";
import { mapConnectedCompensation } from "../scripts/qa/connected-year-end-mapping";
import { prepare2316Certificate } from "../src/lib/bir-2316-certificate";
import { certificateSource, certificateReview } from "./fixtures/bir-2316-certificate";
test("fictional certificate mapping removes exempt contributions once from taxable categories", () => {
  const source = { ...certificateSource, summary: { grossCompensation: "40000.00", nonTaxable: "2500.00", taxableIncome: "37500.00", taxDue: "0.00", withheldBeforeYearEnd: "1000.00", yearEndAdjustment: "-1000.00" },
    withholding: { actualPresentWithheld: "0.00", appliedAdjustment: "-1000.00", issues: [], entryIds: [1] } };
  const detailItems = mapConnectedCompensation({ gross: 4000000, basic: 900000, benefit: 100000, commission: 3000000, contributions: 150000 });
  assert.equal(detailItems["39"], "7500.00");
  const review = { ...certificateReview(), detailItems };
  assert.deepEqual(prepare2316Certificate(source, review).issues, []);
  const duplicate = { ...review, detailItems: { ...detailItems, "39": "9000.00" } };
  assert.ok(prepare2316Certificate(source, duplicate).issues.includes("DETAIL_TOTAL_MISMATCH"));
  const smallBasic = mapConnectedCompensation({ gross: 3020000, basic: 10000, benefit: 10000, commission: 3000000, contributions: 150000 });
  assert.equal(smallBasic["39"], "0.00"); assert.equal(smallBasic["45"], "28600.00");
  assert.throws(() => mapConnectedCompensation({ gross: 1, basic: 2, benefit: 0, commission: 0, contributions: 0 }));
  assert.throws(() => mapConnectedCompensation({ gross: 2, basic: 2, benefit: 0, commission: 0, contributions: 3 }));
});
