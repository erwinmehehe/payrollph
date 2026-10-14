import assert from "node:assert/strict";
import test from "node:test";
import {
  BIR_1604C_REGION_CODES, BIR_1604C_D2_FIELDS, BIR_1604C_C2_FIELDS,
  buildBir1604cDatCandidate,
} from "../src/lib/bir-1604c-dat-candidate";
import { validateBir1604cPreExport, buildReviewedBir1604cCandidate } from "../src/lib/bir-1604c-pre-export";
import { syntheticFilingInput } from "../scripts/qa/bir-1604c-validation-corpus";

function reviewed() {
  const input = syntheticFilingInput();
  return { ...input, records: input.records.map((r, i) => ({ ...r,
    employeeNo: "FICTIONAL-" + i, sourceReference: "fictional-fixture",
    reviewedBy: "Fictional Reviewer", priorEmployerReview: i === 3 ? "form-2316-verified" as const : "none-confirmed" as const,
    ...(i === 3 ? { priorEmployerEvidenceReference: "fictional-prior-2316" } : {}),
    ...(r.schedule === "D2" ? { mwePremiumEvidenceReference: "fictional-exempt-wage-split" } : {}),
  })) };
}

test("official 7.4 region codes serialize as text, while padded or guessed codes fail locally", () => {
  for (const code of BIR_1604C_REGION_CODES) {
    const input = syntheticFilingInput(); input.records[0].fields.REGION_NUM = code;
    const lines = buildBir1604cDatCandidate(input).content.split("\r\n");
    assert.equal(lines[1].split(",")[11], '"' + code + '"');
  }
  for (const code of ["0001", "01", "0000", "9999", "UNKNOWN", ""]) {
    const input = syntheticFilingInput(); input.records[0].fields.REGION_NUM = code;
    assert.throws(() => buildBir1604cDatCandidate(input), /REGION_NUM/);
    const review = reviewed(); review.records[0].fields.REGION_NUM = code;
    assert.equal(validateBir1604cPreExport(review).canGenerateCandidate, false);
  }
});

test("corrected MWE row preserves exempt wages and controls, without treating them as taxable", () => {
  const input = syntheticFilingInput();
  const lines = buildBir1604cDatCandidate(input).content.split("\r\n");
  const detail = lines.find(line => line.startsWith("D2,"))!.split(",");
  const control = lines.find(line => line.startsWith("C2,"))!.split(",");
  for (const field of ["GROSS_COMP_INCOME", "NET_TAXABLE_COMP_INCOME", "PRES_TOTAL_COMP", "PREV_TOTAL_TAXABLE"]) {
    assert.equal(Number(detail[BIR_1604C_D2_FIELDS.indexOf(field as never)]), 0);
    assert.equal(Number(control[BIR_1604C_C2_FIELDS.indexOf(field as never)]), 0);
  }
  for (const field of ["NONTAX_BASIC_SAL", "PRES_NONTAX_BASIC_SMW_YEAR", "PRES_TOTAL_NONTAX_COMP_INCOME"])
    assert.equal(Number(detail[BIR_1604C_D2_FIELDS.indexOf(field as never)]), 156500);
  assert.equal(validateBir1604cPreExport(reviewed()).canGenerateCandidate, true);
});

test("original official MWE errors and centavo drift are rejected in generator and review", () => {
  for (const [field, value] of [
    ["GROSS_COMP_INCOME", "156500.00"], ["NET_TAXABLE_COMP_INCOME", "0.01"],
    ["PRES_TOTAL_COMP", "0.01"], ["PREV_TOTAL_TAXABLE", "0.01"],
  ]) {
    const input = syntheticFilingInput(); input.records[1].fields[field] = value;
    assert.throws(() => buildBir1604cDatCandidate(input), /D2/);
    const review = reviewed(); review.records[1].fields[field] = value;
    assert.ok(validateBir1604cPreExport(review).issues.some(i => i.code === "MWE_TAXABLE_TOTAL"));
  }
  const disabled = buildReviewedBir1604cCandidate(reviewed(), false);
  assert.equal(disabled.ok, false);
  assert.equal(disabled.issues[0].code, "FEATURE_DISABLED");
});
