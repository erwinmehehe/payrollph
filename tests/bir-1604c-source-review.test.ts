import assert from "node:assert/strict";
import test from "node:test";
import { BIR_1604C_LAYOUT, type Bir1604CReviewedRecord } from "../src/lib/bir-1604c-pre-export";
import {
  bindBir1604cReviewToEmployer, buildBir1604cReviewTemplate,
  type Bir1604cSourceSnapshot,
} from "../src/lib/bir-1604c-source-review";

const digest = "a".repeat(64);
const automatic = new Set([
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE",
  "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "REGION_NUM",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "NATIONALITY", "EMPLOYMENT_STATUS",
  "REASON_SEPARATION", "SUBS_FILING", "FACTOR_USED",
]);
function reviewed(schedule: "D1" | "D2" = "D1"): Bir1604CReviewedRecord {
  const fields: Record<string, string | number> = {};
  for (const item of BIR_1604C_LAYOUT[schedule])
    if (!automatic.has(item.name)) fields[item.name] = "0.00"; // deliberately reviewed synthetic fixture
  Object.assign(fields, {
    TIN: "333222111", BRANCH_CODE: "0000",
    LAST_NAME: "SANTOS", FIRST_NAME: "MARIA", MIDDLE_NAME: "",
    REGION_NUM: "0001", EMPLOYMENT_FROM: "01/01/2026",
    EMPLOYMENT_TO: "12/31/2026", NATIONALITY: "FILIPINO",
    EMPLOYMENT_STATUS: "R", REASON_SEPARATION: "NA", SUBS_FILING: "Y",
    NET_TAXABLE_COMP_INCOME: "500000.00", TAX_DUE: "5000.00",
    ACTUAL_AMT_WTHLD: "5000.00", PRES_TAX_WTHLD: "5000.00",
  });
  if (schedule === "D2") fields.FACTOR_USED = "313";
  return {
    schedule, employeeNo: "EMP001", fields,
    priorEmployerReview: "none-confirmed",
    sourceReference: "private-2316-synthetic-review", reviewedBy: "Tax Checker",
    ...(schedule === "D2" ? { mwePremiumEvidenceReference: "private-mwe-premium-split" } : {}),
  };
}
function source(mwe = false): Bir1604cSourceSnapshot {
  return {
    employerTin: "123456789", employerBranch: "0000",
    reconciliation: {
      sourceDigest: digest, totals: { employees: 1, payrollActualWithheld: "5000.00" },
      issues: mwe ? [{ code: "MWE_PREMIUM_SPLIT_REQUIRED", severity: "blocker" as const,
        message: "MWE split needed", employeeNo: "EMP001" }] : [],
      rows: [{ employeeNo: "EMP001", mwe, payrollActualWithheld: "5000.00",
        annualTaxDue: "5000.00" }],
    },
    employeeSources: [{
      employeeNo: "EMP001", firstName: "Maria", middleName: "",
      lastName: "Santos", nationality: "Filipino",
      tin: "333222111", branch: "0000", mwe,
      taxableIncome: "500000.00", taxDue: "5000.00", legalEntityId: 42,
    }],
  };
}
function check(row = reviewed(), snapshot = source(), sourceDigest = digest) {
  return bindBir1604cReviewToEmployer({
    taxYear: 2026, sourceDigest, records: [row],
  }, snapshot, 42);
}
function has(value: ReturnType<typeof check>, code: string) {
  return value.issues.some(issue => issue.code === code);
}

test("operator reviewed D1 row matches legal-employer/year ledger exactly", () => {
  const result = check();
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  if (result.ok) {
    assert.equal(result.input.employerTin, "123456789");
    assert.equal(result.input.expectedActualWithheld, "5000.00");
  }
});
test("stale snapshot / cross legal entity and wrong TIN fail closed", () => {
  assert.ok(has(check(reviewed(), source(), "b".repeat(64)), "STALE_SOURCE"));
  const employer = source();
  employer.employeeSources[0].legalEntityId = 27;
  assert.ok(has(check(reviewed(), employer), "EMPLOYER_DRIFT"));
  const row = reviewed();
  row.fields.TIN = "999999999";
  assert.ok(has(check(row), "EMPLOYEE_TIN_MISMATCH"));
});
test("employee population and annual taxable/tax due must tie to DB ledger", () => {
  const employer = source();
  employer.reconciliation.rows[0].payrollActualWithheld = "5000.02";
  assert.ok(has(check(reviewed(), employer), "EMPLOYEE_WITHHOLDING_MISMATCH"));
  const row = reviewed();
  row.fields.NET_TAXABLE_COMP_INCOME = "100000.00";
  assert.ok(has(check(row), "TAXABLE_INCOME_MISMATCH"));
  const other = reviewed();
  other.employeeNo = "EMP-OTHER";
  assert.ok(has(check(other), "FOREIGN_EMPLOYEE"));
  assert.ok(has(check(other), "MISSING_EMPLOYEE_REVIEW"));
});
test("unresolved cross-employer history remains a blocker even if row fields look complete", () => {
  const employer = source();
  employer.reconciliation.issues.push({
    code: "CROSS_EMPLOYER_PAY", severity: "blocker", message: "Multiple legal employers", employeeNo: "EMP001",
  });
  assert.ok(has(check(reviewed(), employer), "RECONCILIATION_CROSS_EMPLOYER_PAY"));
});
test("D2 MWE draft requires a separately reviewed holiday/OT/night/hazard split", () => {
  const employer = source(true);
  assert.equal(check(reviewed("D2"), employer).ok, true);
  const missing = reviewed("D2");
  delete missing.mwePremiumEvidenceReference;
  assert.ok(has(check(missing, employer), "MWE_PREMIUM_EVIDENCE"));
  assert.ok(has(check(missing, employer), "RECONCILIATION_MWE_PREMIUM_SPLIT_REQUIRED"));
  assert.ok(has(check(reviewed("D1"), employer), "MWE_CLASS"));
});
test("wrong employee identity or nationality cannot be supplied only via uploaded JSON", () => {
  const row = reviewed();
  row.fields.FIRST_NAME = "SUSPECT";
  row.fields.NATIONALITY = "INDIAN";
  assert.ok(has(check(row), "EMPLOYEE_NAME_MISMATCH"));
  assert.ok(has(check(row), "NATIONALITY_MISMATCH"));
});

test("operator template maps only recorded TIN/name/year-end tax and leaves unknowns null", () => {
  const template = buildBir1604cReviewTemplate(source(), 2026);
  assert.ok(template);
  assert.equal(template!.status, "DRAFT-REVIEW-REQUIRED");
  assert.equal(template!.sourceDigest, digest);
  const row = template!.records[0];
  assert.equal(row.schedule, "D1");
  assert.equal(row.fields.TIN, "333222111");
  assert.equal(row.fields.FIRST_NAME, "MARIA");
  assert.equal(row.fields.ACTUAL_AMT_WTHLD, "5000.00");
  assert.equal(row.fields.NET_TAXABLE_COMP_INCOME, "500000.00");
  assert.equal(row.fields.REGION_NUM, null);
  assert.equal(row.fields.PRES_NONTAX_13TH_MONTH, null);
  assert.equal(row.fields.PREV_TAX_WTHLD, null);
  assert.equal(row.priorEmployerReview, "");
  assert.equal(row.reviewedBy, "");
  assert.ok(row.missingManualFields.includes("REGION_NUM"));
  const mwe = buildBir1604cReviewTemplate(source(true), 2026);
  assert.equal(mwe?.records[0].schedule, "D2");
  assert.equal(mwe?.records[0].fields.PRES_NONTAX_NIGHT_DIFF, null);
  assert.equal(mwe?.records[0].fields.FACTOR_USED, null);
});
