import assert from "node:assert/strict";
import test from "node:test";
import { annualize } from "../src/lib/annualization";
import { sumContributionsAndTax } from "../src/lib/year-end";

type Line = { code: string; label: string; amount: number; notes?: string[]; benefitPool90k?: boolean; benefitPoolKind?: string; periodOtherBenefitsPool?: number };
const earning = (code: string, type: string, label: string, amount: number, treatment: string): Line =>
  ({ code, label, amount, notes: ["Type: " + type, "Tax treatment: " + treatment] });
const sum = (lines: Line[]) => sumContributionsAndTax(lines);

test("a non-taxable allowance is recognised as exempt and is NOT mistaken for withheld tax", () => {
  // The label contains "tax": it used to be summed into tax withheld, inflating the refund.
  const parsed = sum([
    { code: "BASIC", label: "Basic / worked pay", amount: 30000 },
    earning("EARN-1", "taxable_allowance", "Non-taxable allowance", 12000, "non-taxable"),
    { code: "SSS", label: "SSS contribution", amount: -875 }, { code: "WHT", label: "Withholding tax", amount: -3259.1 },
  ]);
  assert.equal(parsed.otherNonTaxable, 12000);
  assert.equal(parsed.tax, 3259.1, "only the WHT line is withheld tax");
  assert.equal(parsed.contributions, 875);
});

test("a taxable allowance whose label says Taxable is neither exempt nor withheld tax", () => {
  const parsed = sum([earning("EARN-2", "taxable_allowance", "Taxable allowance", 12000, "taxable"), { code: "WHT", label: "Withholding tax", amount: -6006.2 }]);
  assert.equal(parsed.otherNonTaxable, 0);
  assert.equal(parsed.tax, 6006.2);
});

test("a positive earning named after a contribution is not a contribution", () => {
  const parsed = sum([
    { code: "EARN-3", label: "SSS anniversary bonus", amount: 2000, notes: ["Type: other_taxable", "Tax treatment: taxable"] },
    { code: "EARN-4", label: "PhilHealth wellness stipend", amount: 1500, notes: ["Type: other_taxable", "Tax treatment: taxable"] },
    { code: "SSS", label: "SSS contribution", amount: -875 }, { code: "PHIC", label: "PhilHealth contribution", amount: -750 }, { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: -100 },
    { code: "HDMF_VOL", label: "Pag-IBIG voluntary contribution", amount: -300 },
  ]);
  assert.equal(parsed.contributions, 1725, "875 + 750 + 100; the bonus, the stipend and voluntary Pag-IBIG are not counted");
});

test("a pay-policy premium marked non-taxable and an exempt leave conversion are recognised; the taxable ones are not", () => {
  const premium = (code: string, taxable: "yes" | "no", amount: number): Line => ({ code, label: "Company premium", amount, notes: ["Policy P v1 · rule R", "Taxable: " + taxable + " · SSS base: included · Pag-IBIG base: excluded"] });
  assert.equal(sum([premium("OTPREM-1", "no", 750), premium("NDPREM-2", "no", 125), premium("DAYPREM-3", "no", 240), premium("PREM-4", "no", 400)]).otherNonTaxable, 1515);
  assert.equal(sum([premium("OTPREM-1", "yes", 750), premium("PREM-4", "yes", 400)]).otherNonTaxable, 0);
  const conversion = (treatment: string): Line => ({ code: "LEAVE_CONV-1", label: "Leave Conversion (vacation 5d)", amount: 5000, notes: ["5 days @ daily rate", "Tax treatment: " + treatment] });
  assert.equal(sum([conversion("exempt")]).otherNonTaxable, 5000);
  assert.equal(sum([conversion("taxable")]).otherNonTaxable, 0);
});

test("lines that already have their own bucket are not counted twice", () => {
  const parsed = sum([
    { code: "EXP-1", label: "Expense, travel", amount: 5000, notes: ["Tax treatment: non-taxable"] },
    { code: "DM-uniformClothing", label: "De minimis", amount: 9000, periodOtherBenefitsPool: 1000, notes: ["Tax treatment: non-taxable"] },
    { code: "EARN-5", label: "Bonus", amount: 100000, notes: ["Type: bonus", "Tax treatment: shared PHP 90,000 annual benefit pool"], benefitPool90k: true, benefitPoolKind: "bonus" },
    { code: "EARN-6", label: "13th month", amount: 30000, notes: ["Type: 13th_month", "Tax treatment: shared PHP 90,000 annual benefit pool"], benefitPool90k: true, benefitPoolKind: "13th_month" },
  ]);
  assert.equal(parsed.otherNonTaxable, 0);
  assert.equal(parsed.reimbursements, 5000);
  assert.equal(parsed.deMinimisExempt, 8000);
  assert.equal(parsed.deMinimisExcess, 1000);
  assert.equal(parsed.thirteenth, 30000);
  assert.equal(parsed.otherBenefits, 100000);
});

test("year-end settlement lines keep their sign convention", () => {
  assert.equal(sum([{ code: "WHT", label: "Withholding tax", amount: -3259.1 }, { code: "YE-TAX-1", label: "BIR year-end tax refund (2026)", amount: 100 }]).tax, 3159.1);
  assert.equal(sum([{ code: "WHT", label: "Withholding tax", amount: -3259.1 }, { code: "YE-TAX-1", label: "BIR year-end tax collection (2026)", amount: -200 }]).tax, 3459.1);
});

// A 60,000 worker hired at the switch, 12 cutoffs of 30,000: gross 360,000 + 12,000 non-taxable allowance + 30,000 accrued 13th month = 402,000.
// Non-taxable 30,000 pool + 12,000 allowance + 20,700 contributions = 62,700; taxable 339,300; tax 15% x (339,300 - 250,000) = 13,395.00.
test("annualization counts the exempt allowance, and omitting it keeps the previous calculation", () => {
  const withAllowance = annualize({ grossCompensation: 402000, thirteenthMonth: 30000, otherNonTaxable: 12000, statutoryContributions: 20700, taxWithheld: 39109.2, mwe: false });
  assert.equal(withAllowance.otherNonTaxable, 12000);
  assert.equal(withAllowance.nonTaxable, 62700);
  assert.equal(withAllowance.taxableIncome, 339300);
  assert.equal(withAllowance.taxDue, 13395);
  assert.equal(withAllowance.adjustment, -25714.2);
  const without = annualize({ grossCompensation: 402000, thirteenthMonth: 30000, statutoryContributions: 20700, taxWithheld: 39109.2, mwe: false });
  assert.equal(without.otherNonTaxable, 0);
  assert.equal(without.nonTaxable, 50700);
  assert.equal(without.taxDue, 15195, "the old figure, 1,800.00 too high");
  assert.equal(without.taxDue - withAllowance.taxDue, 1800);
  const input = { grossCompensation: 402000, thirteenthMonth: 30000, statutoryContributions: 20700, taxWithheld: 0, mwe: false } as const;
  assert.equal(annualize({ ...input, otherNonTaxable: -5 }).otherNonTaxable, 0, "a negative amount never increases the exemption");
  assert.throws(() => annualize({ ...input, otherNonTaxable: Number.NaN }), /nonnegative finite/, "a non-finite amount fails closed, like every other input");
});

test("an exempt allowance never changes an MWE's taxable income", () => {
  const base = { grossCompensation: 118652.5, thirteenthMonth: 8800, statutoryContributions: 9315, taxWithheld: 0, mwe: true } as const;
  assert.equal(annualize(base).taxableIncome, 0);
  assert.equal(annualize({ ...base, otherNonTaxable: 3000 }).taxableIncome, 0);
  assert.equal(annualize({ ...base, otherNonTaxable: 3000 }).nonTaxable, 21115);
});

test("a loan repayment, an earned wage advance recovery and a benefit plan deduction are not statutory contributions, whatever their label names", () => {
  const parsed = sum([
    { code: "SSS", label: "SSS contribution", amount: -875 }, { code: "PHIC", label: "PhilHealth contribution", amount: -750 }, { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: -100 },
    { code: "LOAN-7", label: "Loan, SSS Salary Loan", amount: -500 },
    { code: "LOAN-8", label: "Loan, Pag-IBIG Multi-Purpose Loan (MPL)", amount: -400 },
    { code: "EWA-3", label: "Earned wage advance recovery SSS cutoff", amount: -1000 },
    { code: "BEN-2", label: "PhilHealth top-up HMO", amount: -300 },
  ]);
  assert.equal(parsed.contributions, 1725, "only SSS, PHIC and HDMF count");
});

test("a statutory contribution still counts when the code is not one the engine writes today (older or imported lines)", () => {
  assert.equal(sum([{ code: "", label: "SSS employee share", amount: -875 }, { code: "PAGIBIG", label: "Pag-IBIG", amount: -100 }]).contributions, 975);
});
