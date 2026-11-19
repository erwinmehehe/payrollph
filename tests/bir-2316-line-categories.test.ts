import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { annualize } from "../src/lib/annualization";
import { reviewBir2316Summary } from "../src/lib/bir-2316-reconciliation";
import { categorizeBir2316Lines, classifyBir2316Line, reconcileBir2316Categories, type Bir2316Line } from "../src/lib/bir-2316-line-categories";

const POOL_NOTE = "Tax treatment: shared PHP 90,000 annual benefit pool";
const earning = (code: string, type: string, amount: number, treatment: string, extra: Partial<Bir2316Line> = {}): Bir2316Line =>
  ({ code, label: type, amount, notes: ["Type: " + type, "Tax treatment: " + treatment], ...extra });
const poolEarning = (code: string, type: string, amount: number) =>
  ({ code, label: type, amount, notes: ["Type: " + type, POOL_NOTE], benefitPool90k: true, benefitPoolKind: type }) as Bir2316Line;
const line = (code: string, amount: number, label = code): Bir2316Line => ({ code, label, amount });

// An ordinary taxpayer's year. Every figure below is derived by hand.
//   gross = 360,000 basic + 12,000 OT + 1,500 ND + 3,000 holiday + 2,000 hazard + 100,000 bonus + 30,000 13th + 20,000 commission
//           + 6,000 taxable allowance + 9,000 de minimis = 543,500 (the 5,000 reimbursement is not compensation).
//   pool = 100,000 + 30,000 + 1,000 de minimis excess = 131,000: exempt 90,000 (item 34), taxable 41,000 (item 48).
//   de minimis exempt 8,000 (item 35); contributions 10,500 + 9,000 + 2,400 = 21,900 (item 36), carved out of basic pay.
//   item 39 = 360,000 - 21,900 = 338,100. Non-taxable 90,000 + 8,000 + 21,900 = 119,900; taxable 543,500 - 119,900 = 423,600.
const ordinaryLines: Bir2316Line[] = [
  line("BASIC", 360000), line("OT", 12000), line("ND", 1500), line("HOLIDAY", 3000), line("CALAMITY", 2000),
  poolEarning("EARN-1", "bonus", 100000), poolEarning("EARN-2", "13th_month", 30000),
  earning("EARN-3", "commission", 20000, "taxable"), earning("EARN-4", "taxable_allowance", 6000, "taxable"),
  { code: "DM-uniformClothing", label: "De minimis", amount: 9000, periodOtherBenefitsPool: 1000 },
  line("SSS", -10500), line("PHIC", -9000), line("HDMF", -2400),
  line("HDMF_VOL", -600), line("WHT", -60000), line("LOAN-1", -3000), line("EXP-1", 5000), line("YE-TAX-1", -100),
];
const ordinaryAnnual = annualize({ grossCompensation: 543500, thirteenthMonth: 30000, otherBenefits: 100000, deMinimis: 8000, deMinimisExcess: 1000, statutoryContributions: 21900, taxWithheld: 27220, mwe: false });

test("an ordinary taxpayer's lines land in exactly the 2316 items the arithmetic requires", () => {
  const result = categorizeBir2316Lines(ordinaryLines, { mwe: false });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(result.items, {
    "34": "90000.00", "35": "8000.00", "36": "21900.00", "39": "338100.00", "44A": "6000.00", "45": "20000.00",
    "48": "41000.00", "49": "2000.00", "50": "12000.00", "51A": "1500.00", "51B": "3000.00",
  });
  assert.deepEqual(result.descriptions, { "44A": "Taxable allowance", "51A": "Night differential", "51B": "Holiday and rest-day premium" });
  assert.deepEqual(result.basis["50"], ["OT"]);
  assert.deepEqual(result.basis["36"], ["SSS", "PHIC", "HDMF"]);
  assert.equal(result.tiers["50"], "direct");
  assert.equal(result.tiers["51A"], "convention", "night differential has no 2316 line of its own and must be confirmed");
});

test("the categorised items reconcile to the real annualization result and satisfy the real 2316 reviewer", () => {
  assert.equal(ordinaryAnnual.nonTaxable, 119900);
  assert.equal(ordinaryAnnual.taxableIncome, 423600);
  const result = categorizeBir2316Lines(ordinaryLines, { mwe: false });
  assert.deepEqual(reconcileBir2316Categories(result, ordinaryAnnual), []);
  assert.ok(result.detailItems, "a complete result yields every item, zeros included");
  assert.equal(result.detailItems!["29"], "0.00");
  assert.equal(Object.keys(result.detailItems!).length, 24);
  const review = reviewBir2316Summary({
    grossCompensation: "543500.00", nonTaxable: "119900.00", taxableIncome: "423600.00", taxDue: ordinaryAnnual.taxDue.toFixed(2),
    withheldBeforeYearEnd: "27220.00", yearEndAdjustment: "0.00",
  }, { detailItems: result.detailItems!, previousEmployer: { status: "none-confirmed" }, actualPresentWithheld: "27220.00", appliedAdjustment: "0.00", peraCredit: "0.00" });
  const codes = review.issues.map((issue) => issue.code);
  for (const blocked of ["DETAIL_TOTAL_MISMATCH", "COMPENSATION_TOTAL_MISMATCH", "UNMAPPED_DETAIL_ITEM", "EXEMPT_BENEFIT_CAP", "INVALID_OR_MISSING_AMOUNT"]) {
    assert.ok(!codes.includes(blocked), blocked + " must not be raised by a reconciled categorisation: " + codes.join(", "));
  }
});

// An MWE hired at the switch (the Phase 22 shape): basic 105,600, OT 4,000, ND 12.50, holiday 240, contributions 9,315, accrued 13th 8,800.
//   gross = 105,600 + 4,252.50 + 8,800 accrued = 118,652.50. Basic is carved by contributions: 29 = 105,600 - 9,315 = 96,285.
test("an MWE's basic pay and premiums are exempt items 29-33 and the accrued unpaid 13th month joins the pool", () => {
  const lines = [line("BASIC", 105600), line("OT", 4000), line("ND", 12.5), line("HOLIDAY", 240), line("SSS", -5475), line("PHIC", -2640), line("HDMF", -1200)];
  const result = categorizeBir2316Lines(lines, { mwe: true, accruedUnpaidThirteenth: 8800 });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.items, { "29": "96285.00", "30": "240.00", "31": "4000.00", "32": "12.50", "34": "8800.00", "36": "9315.00" });
  assert.equal(result.tiers["32"], "direct", "an MWE's night differential has its own item");
  assert.deepEqual(result.descriptions, {}, "an MWE needs no description for these items");
  const annual = annualize({ grossCompensation: 118652.5, thirteenthMonth: 8800, statutoryContributions: 9315, taxWithheld: 0, mwe: true });
  assert.deepEqual(reconcileBir2316Categories(result, annual), []);
});

test("an ordinary taxpayer's overtime, night, holiday and hazard pay are taxable items, never exempt", () => {
  assert.deepEqual(classifyBir2316Line(line("OT", 1), false), { to: "item", item: "50", tier: "direct" });
  assert.deepEqual(classifyBir2316Line(line("OT", 1), true), { to: "item", item: "31", tier: "direct" });
  assert.deepEqual(classifyBir2316Line(line("CALAMITY", 1), false), { to: "item", item: "49", tier: "direct" });
  assert.deepEqual(classifyBir2316Line(line("CALAMITY", 1), true), { to: "item", item: "33", tier: "direct" });
  for (const code of ["OT", "ND", "HOLIDAY", "CALAMITY"]) {
    const target = classifyBir2316Line(line(code, 1), false);
    assert.ok(target.to === "item" && Number(target.item.replace(/\D/g, "")) >= 39, code + " must be a taxable item for an ordinary taxpayer");
  }
});

test("lines that need a legal reading are refused with a reason, never guessed or zero-filled", () => {
  const lines: Bir2316Line[] = [
    line("BASIC", 100000), line("SSS", -3000),
    { code: "OTPREM-7", label: "Company overtime top-up", amount: 750, notes: ["Taxable: yes"] },
    { code: "PREM-2", label: "Company premium", amount: 400 },
    { code: "LEAVE_CONV-3", label: "Leave conversion", amount: 5000, notes: ["Tax treatment: exempt"] },
    earning("EARN-9", "other_taxable", 800, "taxable"),
    line("MYSTERY", 123.45),
  ];
  const result = categorizeBir2316Lines(lines, { mwe: false });
  assert.deepEqual(result.unmapped.map((item) => [item.code, item.amount]), [["OTPREM-7", "750.00"], ["PREM-2", "400.00"], ["LEAVE_CONV-3", "5000.00"], ["EARN-9", "800.00"], ["MYSTERY", "123.45"]]);
  for (const item of result.unmapped) assert.ok(item.reason.length > 10);
  assert.equal(result.detailItems, null, "no item is certified while anything is unmapped");
  assert.match(result.issues.join(" "), /UNMAPPED_LINES: 5/);
  assert.deepEqual(result.items, { "36": "3000.00", "39": "97000.00" }, "unmapped amounts are not folded into any item");
});

test("imported months have no lines, so the result is incomplete instead of silently short", () => {
  const result = categorizeBir2316Lines([line("BASIC", 60000)], { mwe: false, importedPeriods: 6 });
  assert.match(result.issues.join(" "), /IMPORTED_HISTORY_NOT_CATEGORISED: 6/);
  assert.equal(result.detailItems, null);
});

test("deductions, tax settlements and reimbursements are not compensation", () => {
  const result = categorizeBir2316Lines([line("WHT", -5000), line("HDMF_VOL", -200), line("LOAN-1", -900), line("EWA-2", -400), line("EXP-3", 700), line("YE-TAX-4", 50), line("LATE", -10)], { mwe: false });
  assert.deepEqual(result.items, {});
  assert.deepEqual(result.unmapped, []);
  assert.deepEqual(result.issues, []);
});

test("the 90,000 pool cap is exact to the centavo", () => {
  const at = categorizeBir2316Lines([poolEarning("EARN-1", "bonus", 90000)], { mwe: false });
  assert.deepEqual(at.items, { "34": "90000.00" });
  const over = categorizeBir2316Lines([poolEarning("EARN-1", "bonus", 90000.01)], { mwe: false });
  assert.deepEqual(over.items, { "34": "90000.00", "48": "0.01" });
  const mixed = categorizeBir2316Lines([poolEarning("EARN-1", "13th_month", 60000), poolEarning("EARN-2", "bonus", 40000)], { mwe: false, accruedUnpaidThirteenth: 5000 });
  assert.deepEqual(mixed.items, { "34": "90000.00", "48": "15000.00" });
});

test("when contributions exceed basic pay the items cannot be reconciled and nothing is certified", () => {
  const result = categorizeBir2316Lines([line("BASIC", 1000), line("SSS", -1500)], { mwe: false });
  assert.match(result.issues.join(" "), /CONTRIBUTIONS_EXCEED_BASIC/);
  assert.equal(result.detailItems, null);
});

test("a non-taxable allowance is item 37, and reconciliation exposes it if year end does not treat it as exempt", () => {
  const lines = [line("BASIC", 120000), line("SSS", -3000), earning("EARN-5", "taxable_allowance", 12000, "non-taxable")];
  const result = categorizeBir2316Lines(lines, { mwe: false });
  assert.deepEqual(result.items, { "36": "3000.00", "37": "12000.00", "39": "117000.00" });
  // annualization recognises only the pool, de minimis and contributions as non-taxable, so it cannot see item 37.
  const annual = annualize({ grossCompensation: 132000, thirteenthMonth: 0, statutoryContributions: 3000, taxWithheld: 0, mwe: false });
  const issues = reconcileBir2316Categories(result, annual);
  assert.equal(annual.nonTaxable, 3000);
  assert.ok(issues.some((issue) => issue.startsWith("EXEMPT_TOTAL_MISMATCH")), issues.join(" | "));
  assert.ok(issues.some((issue) => issue.startsWith("TAXABLE_TOTAL_MISMATCH")), issues.join(" | "));
  assert.ok(!issues.some((issue) => issue.startsWith("GROSS_MISMATCH")), "the items still add up to gross");
});

test("reconciliation reports a gross mismatch and an MWE status mismatch", () => {
  const result = categorizeBir2316Lines(ordinaryLines, { mwe: false });
  assert.ok(reconcileBir2316Categories(result, { ...ordinaryAnnual, grossCompensation: ordinaryAnnual.grossCompensation + 0.01 }).some((i) => i.startsWith("GROSS_MISMATCH")));
  assert.ok(reconcileBir2316Categories(result, { ...ordinaryAnnual, mwe: true }).some((i) => i.startsWith("MWE_STATUS_DIFFERS")));
});

test("the module is pure and wired into no route", () => {
  const source = readFileSync("src/lib/bir-2316-line-categories.ts", "utf8");
  assert.ok(!/from "@\/db|from "\.\.\/db|writeFile|fetch\(|process\.env/.test(source));
  assert.match(source, /convention/);
});
