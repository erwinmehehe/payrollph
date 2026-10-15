import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BIR_2316_NON_TAX_ITEMS, BIR_2316_TAX_ITEMS, bir2316Centavos, reviewBir2316Summary, type Bir2316MappingEvidence } from "../src/lib/bir-2316-reconciliation";
import { renderBir2316ReviewHtml } from "../src/lib/bir-2316-print";
import { computeFinalPay } from "../src/lib/final-pay";
import { annualize, renderForm2316 } from "../src/lib/annualization";
const source = () => ({ grossCompensation: "600000.00", nonTaxable: "100000.00", taxableIncome: "500000.00", taxDue: "42500.00", withheldBeforeYearEnd: "40000.00", yearEndAdjustment: "2500.00" });
function evidence(): Bir2316MappingEvidence {
  const detailItems: Record<string, string> = Object.fromEntries([...BIR_2316_NON_TAX_ITEMS, ...BIR_2316_TAX_ITEMS].map(item => [item, "0.00"]));
  Object.assign(detailItems, { "34": "90000.00", "36": "10000.00", "39": "500000.00" });
  return { detailItems, previousEmployer: { status: "none-confirmed" }, actualPresentWithheld: "42500.00", appliedAdjustment: "2500.00", peraCredit: "0.00" };
}
const codes = (s = source(), e?: Bir2316MappingEvidence) => reviewBir2316Summary(s, e).issues.map(i => i.code);
test("explicit detail mappings reconcile numbered compensation and withholding without certifying issuance", () => {
  const r = reviewBir2316Summary(source(), evidence());
  assert.equal(r.reconciled, true); assert.equal(r.officialCertificate, false);
  assert.equal(r.rows.find(x => x.item === "28")?.centavos, 4250000);
  assert.equal(r.rows.find(x => x.item === "23")?.centavos, 50000000);
});
test("one-cent compensation, expected and actual withholding drift is rejected", () => {
  assert.ok(codes({ ...source(), nonTaxable: "100000.01" }, evidence()).includes("COMPENSATION_TOTAL_MISMATCH"));
  assert.ok(codes({ ...source(), yearEndAdjustment: "2500.01" }, evidence()).includes("EXPECTED_WITHHOLDING_MISMATCH"));
  const e = evidence(); e.actualPresentWithheld = "42499.99";
  assert.ok(codes(source(), e).includes("ACTUAL_WITHHOLDING_MISMATCH"));
  assert.ok(codes(source(), e).includes("ACTUAL_LEDGER_MISMATCH"));
});
test("refunds must actually be applied, not inferred from a settled label", () => {
  const s = { ...source(), withheldBeforeYearEnd: "45000.00", yearEndAdjustment: "-2500.00" };
  const e = evidence(); e.appliedAdjustment = "-2500.00";
  assert.equal(reviewBir2316Summary(s, e).reconciled, true);
  e.appliedAdjustment = "0.00"; e.actualPresentWithheld = "45000.00";
  assert.ok(codes(s, e).includes("UNSETTLED_ADJUSTMENT"));
});
test("tax collection exceeding final gross cannot be represented as fully withheld", () => {
  const final = computeFinalPay({ releasedBasicYtd: 600000, historicalBasicYtd: 0, unpaidBasicSalary: 1000,
    thirteenthPaidYtd: 50000, grossCompensationYtd: 600000, statutoryContributionsYtd: 0,
    taxWithheldYtd: 0, mwe: false, leaveMonetizationPay: 0, separationPay: 0,
    retirementPay: 0, otherBenefits: 0, loanDeductions: 0 });
  assert.ok(final.requestedTaxCollection > final.grossFinalPay);
  assert.ok(final.unpaidTaxWithholding > 0);
  const a = final.annualization;
  const e = evidence(); for (const item of Object.keys(e.detailItems)) e.detailItems[item] = "0.00";
  e.detailItems["34"] = a.exemptBenefitPool; e.detailItems["39"] = a.taxableIncome;
  e.appliedAdjustment = final.appliedTaxCollection; e.actualPresentWithheld = a.taxWithheld + final.appliedTaxCollection;
  const r = reviewBir2316Summary({ grossCompensation: a.grossCompensation, nonTaxable: a.nonTaxable,
    taxableIncome: a.taxableIncome, taxDue: a.taxDue, withheldBeforeYearEnd: a.taxWithheld, yearEndAdjustment: a.adjustment }, e);
  assert.ok(r.issues.some(i => i.code === "UNSETTLED_ADJUSTMENT"));
  assert.ok(r.issues.some(i => i.code === "ACTUAL_WITHHOLDING_MISMATCH"));
  assert.equal(r.rows.find(x => x.item === "25A")?.centavos, Math.round(final.appliedTaxCollection * 100));
});
test("previous employer compensation and withholding are distinct; never merged into present gross", () => {
  const e = evidence(); e.previousEmployer = { status: "verified", taxableCompensation: "200000.00", taxWithheld: "5000.00" };
  const r = reviewBir2316Summary({ ...source(), taxDue: "47500.00" }, e);
  assert.equal(r.reconciled, true); assert.equal(r.rows.find(x => x.item === "19")?.centavos, 60000000);
  assert.equal(r.rows.find(x => x.item === "23")?.centavos, 70000000);
  assert.equal(r.rows.find(x => x.item === "26")?.centavos, 4750000);
});
test("missing previous-employer, settlement, detail and PERA evidence remain unknown, not zero", () => {
  const r = reviewBir2316Summary(source());
  for (const code of ["PREVIOUS_EMPLOYER_UNVERIFIED", "SETTLEMENT_UNVERIFIED", "DETAIL_MAPPING_UNVERIFIED", "PERA_CREDIT_UNVERIFIED"]) assert.ok(r.issues.some(i => i.code === code));
  assert.equal(r.rows.find(x => x.item === "25B")?.centavos, null); assert.equal(r.reconciled, false);
});
test("every mapped category is required explicitly and category sum drift is blocked", () => {
  for (const item of [...BIR_2316_NON_TAX_ITEMS, ...BIR_2316_TAX_ITEMS]) {
    const e = evidence(); delete e.detailItems[item]; assert.ok(codes(source(), e).includes("INVALID_OR_MISSING_AMOUNT"), item);
  }
  const e = evidence(); e.detailItems["39"] = "499999.99";
  assert.ok(codes(source(), e).includes("DETAIL_TOTAL_MISMATCH"));
});
test("unmapped detail items and benefit exemptions exceeding the official cap are blocked", () => {
  const unknown = evidence(); unknown.detailItems["99"] = "1.00";
  assert.ok(codes(source(), unknown).includes("UNMAPPED_DETAIL_ITEM"));
  const over = evidence(); over.detailItems["34"] = "90000.01";
  assert.ok(codes(source(), over).includes("EXEMPT_BENEFIT_CAP"));
});
test("MWE exempt wages must be included in total exempt mapping without changing tax calculations", () => {
  const s = { ...source(), grossCompensation: "156500.00", nonTaxable: "156500.00", taxableIncome: "0.00", taxDue: "0.00", withheldBeforeYearEnd: "0.00", yearEndAdjustment: "0.00" };
  const e = evidence(); for (const key of Object.keys(e.detailItems)) e.detailItems[key] = "0.00";
  e.detailItems["29"] = "156500.00"; e.actualPresentWithheld = "0.00"; e.appliedAdjustment = "0.00";
  assert.equal(reviewBir2316Summary(s, e).reconciled, true);
  assert.ok(codes({ ...s, nonTaxable: "0.00" }, e).includes("COMPENSATION_TOTAL_MISMATCH"));
});
test("PERA credit is explicit and contributes to item 28 independently of cash withholding", () => {
  const e = evidence(); e.peraCredit = "100.00"; e.actualPresentWithheld = "42400.00"; e.appliedAdjustment = "2400.00";
  const r = reviewBir2316Summary({ ...source(), yearEndAdjustment: "2400.00" }, e);
  assert.equal(r.reconciled, true); assert.equal(r.rows.find(x => x.item === "28")?.centavos, 4250000);
});
test("invalid precision, empty, nonfinite and unsafe money cannot become a valid centavo amount", () => {
  for (const v of ["", " ", "NaN", Infinity, NaN, "1e3", "1.001", "9007199254740991.00", null, undefined, "-1.00"]) assert.equal(bir2316Centavos(v), null);
  assert.equal(bir2316Centavos("-0.01", true), -1);
});
const htmlInput = () => ({ ...source(), taxYear: 2026, employerName: "<Fictional>", employerTin: "123456789-0000", employeeNo: "FICTIONAL", employeeName: "<script>alert(1)</script>", employeeTin: "987654321-0000", employmentStart: "2026-01-01", mwe: false, sourceStatus: "settled", ruleVersion: "PH-2026.03", exemptBenefitPool: "90000.00", deMinimis: "0.00", statutoryContributions: "10000.00" });
const textInput = () => ({ taxYear: 2026, employerName: "Fictional", employeeName: "Fictional Worker", employeeNo: "FICTIONAL", result: annualize({ grossCompensation: 600000, thirteenthMonth: 90000, statutoryContributions: 10000, taxWithheld: 40000, mwe: false }) });
test("flag off matches pre-change HTML and text snapshots; exact true enables numbered warnings in both outputs", () => {
  const saved = process.env.BIR_2316_RECONCILIATION_ENABLED;
  const snapshots = JSON.parse(readFileSync("tests/fixtures/bir-2316-legacy-output-hashes.json", "utf8"));
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  try {
    for (const disabled of [undefined, "false", "TRUE", "1"]) {
      if (disabled === undefined) delete process.env.BIR_2316_RECONCILIATION_ENABLED; else process.env.BIR_2316_RECONCILIATION_ENABLED = disabled;
      assert.equal(hash(renderBir2316ReviewHtml(htmlInput())), snapshots.html);
      assert.equal(hash(renderForm2316(textInput())), snapshots.text);
    }
    process.env.BIR_2316_RECONCILIATION_ENABLED = "true";
    const html = renderBir2316ReviewHtml(htmlInput());
    assert.match(html, /Numbered 2316 reconciliation/); assert.match(html, /SETTLEMENT_UNVERIFIED/);
    assert.match(html, /REQUIRES VERIFIED SOURCE/); assert.doesNotMatch(html, /<script>/);
    assert.match(renderForm2316(textInput()), /Alphalist DAT validation does not validate this certificate/);
  } finally { if (saved === undefined) delete process.env.BIR_2316_RECONCILIATION_ENABLED; else process.env.BIR_2316_RECONCILIATION_ENABLED = saved; }
});
