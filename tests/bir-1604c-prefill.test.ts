import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { annualize } from "../src/lib/annualization";
import { BIR_1604C_D1_FIELDS, BIR_1604C_D2_FIELDS, buildBir1604cDatCandidate } from "../src/lib/bir-1604c-dat-candidate";
import { applyBir1604cPrefill, prefillBir1604cPresentEmployer } from "../src/lib/bir-1604c-prefill";

// Real annualization results. The expected values below were derived by hand from the TRAIN pool rules, not from the module under test.

// Ordinary worker, bonus overflow (the Phase 21 shape): 13th 60,000 + other benefits 100,000 = pool 160,000, exempt 90,000, taxable pool 70,000.
// Non-taxable 90,000 + 0 + 41,400 = 131,400; taxable 880,000 - 131,400 = 748,600.
const overflow = annualize({ grossCompensation: 880000, thirteenthMonth: 60000, otherBenefits: 100000, deMinimis: 0, deMinimisExcess: 0, statutoryContributions: 41400, taxWithheld: 80465.5, mwe: false });
// Ordinary worker with de minimis (the Phase 18 shape): pool 60,000 + 40,000 + excess 28,000 = 128,000, exempt 90,000, taxable pool 38,000.
// Non-taxable 90,000 + 8,000 + 41,400 = 139,400; taxable 856,000 - 139,400 = 716,600.
const deMinimisCase = annualize({ grossCompensation: 856000, thirteenthMonth: 60000, otherBenefits: 40000, deMinimis: 8000, deMinimisExcess: 28000, statutoryContributions: 41400, taxWithheld: 87465.5, mwe: false });
// MWE hired at the switch (the Phase 22 shape): 13th 8,800 inside the pool; contributions 9,315; non-taxable 8,800 + 9,315 = 18,115.
const mwe = annualize({ grossCompensation: 118652.5, thirteenthMonth: 8800, deMinimis: 0, statutoryContributions: 9315, taxWithheld: 0, mwe: true });

test("an ordinary worker with a pool overflow gets exactly the lines the annualization identity proves", () => {
  assert.equal(overflow.nonTaxable, 131400);
  assert.equal(overflow.taxableIncome, 748600);
  const prefill = prefillBir1604cPresentEmployer(overflow);
  assert.equal(prefill.schedule, "D1");
  assert.deepEqual(prefill.issues, []);
  assert.deepEqual(prefill.suggestions, {
    PRES_NONTAX_13TH_MONTH: "90000.00",
    PRES_NONTAX_DE_MINIMIS: "0.00",
    PRES_NONTAX_SSS_ETC: "41400.00",
    PRES_TAXABLE_13TH_MONTH: "70000.00",
    NONTAX_BASIC_SAL: "0.00",
    PRES_NONTAX_SALARIES: "0.00",
    PRES_TOTAL_NONTAX_COMP_INCOME: "131400.00",
    PRES_TOTAL_COMP: "748600.00",
  });
  for (const field of Object.keys(prefill.suggestions)) assert.ok(prefill.sources[field], field + " must say how it was derived");
});

test("de minimis stays separate from the capped pool", () => {
  const prefill = prefillBir1604cPresentEmployer(deMinimisCase);
  assert.deepEqual(prefill.issues, []);
  assert.equal(prefill.suggestions.PRES_NONTAX_13TH_MONTH, "90000.00");
  assert.equal(prefill.suggestions.PRES_NONTAX_DE_MINIMIS, "8000.00");
  assert.equal(prefill.suggestions.PRES_TAXABLE_13TH_MONTH, "38000.00");
  assert.equal(prefill.suggestions.PRES_TOTAL_NONTAX_COMP_INCOME, "139400.00");
  assert.equal(prefill.suggestions.PRES_TOTAL_COMP, "716600.00");
});

test("an MWE (D2) gets only the pool, de minimis and contribution lines, never a total or an exempt wage guess", () => {
  const prefill = prefillBir1604cPresentEmployer(mwe);
  assert.equal(prefill.schedule, "D2");
  assert.deepEqual(prefill.issues, []);
  assert.deepEqual(prefill.suggestions, {
    PRES_NONTAX_13TH_MONTH: "8800.00",
    PRES_NONTAX_DE_MINIMIS: "0.00",
    PRES_NONTAX_SSS_ETC: "9315.00",
    PRES_TAXABLE_13TH_MONTH: "0.00",
  });
  for (const guessed of ["PRES_NONTAX_BASIC_SMW_DAY", "PRES_NONTAX_BASIC_SMW_MONTH", "PRES_NONTAX_BASIC_SMW_YEAR", "PRES_NONTAX_HOLIDAY_PAY",
    "PRES_NONTAX_OVERTIME_PAY", "PRES_NONTAX_NIGHT_DIFF", "PRES_NONTAX_HAZARD_PAY", "PRES_NONTAX_SALARIES", "PRES_TOTAL_NONTAX_COMP_INCOME", "PRES_TOTAL_COMP", "NONTAX_BASIC_SAL"]) {
    assert.ok(!(guessed in prefill.suggestions), guessed + " cannot be derived from the year-end row for an MWE");
    assert.ok(prefill.stillManual.includes(guessed), guessed + " must be listed for a person to supply");
  }
});

test("what the year-end row does not carry is listed for a person and never zero-filled", () => {
  const prefill = prefillBir1604cPresentEmployer(overflow);
  for (const field of ["TAX_BASIC_SAL", "PRES_TAXABLES_SALARIES", "GROSS_COMP_INCOME", "PRES_NONTAX_GROSS_COMP_INCOME", "PREV_NONTAX_GROSS_COMP_INCOME", "PREV_TOTAL_TAXABLE",
    "PREV_TAX_WTHLD", "PRES_TAX_WTHLD", "AMT_WTHLD_DEC", "OVER_WTHLD", "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "EMPLOYMENT_STATUS", "REASON_SEPARATION", "SUBS_FILING", "TAX_CREDIT_PERA"]) {
    assert.ok(!(field in prefill.suggestions), field + " must not be suggested");
    assert.ok(prefill.stillManual.includes(field), field + " must remain manual");
  }
  // The template already fills these from verified sources, so they are not asked of the reviewer twice.
  for (const field of ["TIN", "LAST_NAME", "TAX_DUE", "NET_TAXABLE_COMP_INCOME", "ACTUAL_AMT_WTHLD"]) assert.ok(!prefill.stillManual.includes(field));
});

test("every suggestion belongs to the schedule's layout and is a DAT-ready amount", () => {
  for (const [result, layout] of [[overflow, BIR_1604C_D1_FIELDS], [deMinimisCase, BIR_1604C_D1_FIELDS], [mwe, BIR_1604C_D2_FIELDS]] as const) {
    const prefill = prefillBir1604cPresentEmployer(result);
    for (const [field, value] of Object.entries(prefill.suggestions)) {
      assert.ok((layout as readonly string[]).includes(field), field + " is not in the " + prefill.schedule + " layout");
      assert.match(value, /^(0|[1-9][0-9]{0,10})\.[0-9]{2}$/);
    }
  }
});

test("when an identity fails nothing is suggested and the reason is reported", () => {
  const brokenNonTaxable = prefillBir1604cPresentEmployer({ ...overflow, nonTaxable: overflow.nonTaxable + 0.01 });
  assert.deepEqual(brokenNonTaxable.suggestions, {});
  assert.match(brokenNonTaxable.issues.join(" "), /NON_TAXABLE_IDENTITY_FAILED/);
  const brokenTaxable = prefillBir1604cPresentEmployer({ ...overflow, taxableIncome: overflow.taxableIncome - 1 });
  assert.deepEqual(brokenTaxable.suggestions, {});
  assert.match(brokenTaxable.issues.join(" "), /TAXABLE_IDENTITY_FAILED/);
  for (const bad of [Number.NaN, -1, 1.005, Number.POSITIVE_INFINITY]) {
    const prefill = prefillBir1604cPresentEmployer({ ...overflow, statutoryContributions: bad });
    assert.deepEqual(prefill.suggestions, {});
    assert.match(prefill.issues.join(" "), /INVALID_OR_MISSING_AMOUNT/);
  }
});

test("merging fills only empty fields and reports, never overwrites, a reviewer's different value", () => {
  const prefill = prefillBir1604cPresentEmployer(overflow);
  const merged = applyBir1604cPrefill({
    PRES_NONTAX_13TH_MONTH: null, PRES_NONTAX_DE_MINIMIS: "0", PRES_NONTAX_SSS_ETC: "41000.00", TAX_BASIC_SAL: null,
  }, prefill);
  assert.equal(merged.fields.PRES_NONTAX_13TH_MONTH, "90000.00");
  assert.equal(merged.fields.PRES_NONTAX_SSS_ETC, "41000.00", "a reviewer's value is never replaced");
  assert.deepEqual(merged.conflicts, ["PRES_NONTAX_SSS_ETC"]);
  assert.ok(!merged.conflicts.includes("PRES_NONTAX_DE_MINIMIS"), "the same amount in another notation is not a conflict");
  assert.equal(merged.fields.TAX_BASIC_SAL, null, "a field that is not suggested stays empty");
  assert.ok(merged.applied.includes("PRES_NONTAX_13TH_MONTH") && !merged.applied.includes("PRES_NONTAX_SSS_ETC"));
});

test("the suggestions are accepted by the real 1604-C DAT builder and land in the prescribed columns", () => {
  const prefill = prefillBir1604cPresentEmployer(overflow);
  const nonMoney = new Set(["SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR", "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE", "LAST_NAME", "FIRST_NAME",
    "MIDDLE_NAME", "REGION_NUM", "NATIONALITY", "EMPLOYMENT_STATUS", "REASON_SEPARATION", "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "SUBS_FILING"]);
  const generated = new Set(["SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR", "RETRN_PERIOD", "SEQ_NUM"]);
  const fields: Record<string, string> = {};
  for (const name of BIR_1604C_D1_FIELDS) if (!generated.has(name)) fields[name] = nonMoney.has(name) ? "" : "0.00";
  Object.assign(fields, {
    TIN: "123456789", BRANCH_CODE: "0000", LAST_NAME: "GOLDEN", FIRST_NAME: "FICTIONAL", MIDDLE_NAME: "", REGION_NUM: "NCR", NATIONALITY: "FILIPINO",
    EMPLOYMENT_FROM: "01/01/2026", EMPLOYMENT_TO: "12/31/2026", EMPLOYMENT_STATUS: "R", REASON_SEPARATION: "NA", SUBS_FILING: "Y",
    NET_TAXABLE_COMP_INCOME: "748600.00", TAX_DUE: "92220.00", ACTUAL_AMT_WTHLD: "80465.50",
  });
  const merged = applyBir1604cPrefill(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, k in prefill.suggestions ? null : v])), prefill);
  assert.deepEqual(merged.conflicts, []);
  const built = buildBir1604cDatCandidate({
    employerTin: "987654321", employerBranch: "0000", taxYear: 2026, expectedEmployees: 1, expectedActualWithheld: "80465.50",
    records: [{ schedule: "D1", fields: merged.fields as Record<string, string> }],
  });
  const detail = built.content.split("\r\n").find((line) => line.startsWith("D1,"))!.split(",");
  const column = (name: string) => detail[(BIR_1604C_D1_FIELDS as readonly string[]).indexOf(name)];
  assert.equal(column("PRES_NONTAX_13TH_MONTH"), "00000090000.00");
  assert.equal(column("PRES_TAXABLE_13TH_MONTH"), "00000070000.00");
  assert.equal(column("PRES_NONTAX_SSS_ETC"), "00000041400.00");
  assert.equal(column("PRES_TOTAL_NONTAX_COMP_INCOME"), "00000131400.00");
  assert.equal(column("PRES_TOTAL_COMP"), "00000748600.00");
  assert.equal(built.validatedByBir, false, "the file stays an unvalidated candidate");
});

test("the module is pure and wired into no route", () => {
  const source = readFileSync("src/lib/bir-1604c-prefill.ts", "utf8");
  assert.ok(!/from "@\/db|from "\.\.\/db|writeFile|fetch\(|process\.env/.test(source), "no database, file, network or environment access");
  assert.match(source, /INFERRED FROM FIELD ORDER/, "the unverified correspondence must stay stated in the module");
});
