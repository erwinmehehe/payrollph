import assert from "node:assert/strict";
import test from "node:test";
import {
  BIR_1604C_D1_FIELDS,
  BIR_1604C_D2_FIELDS,
  BIR_1604C_C1_FIELDS,
  BIR_1604C_C2_FIELDS,
  buildBir1604cDatCandidate,
} from "../src/lib/bir-1604c-dat-candidate";

const administrative = new Set([
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE",
  "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "REGION_NUM",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "NATIONALITY",
  "EMPLOYMENT_STATUS", "REASON_SEPARATION", "FACTOR_USED",
]);
function complete(schedule: "D1" | "D2", tax: string, withheld: number) {
  const names = schedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS;
  const fields: Record<string,string|number> = {};
  // Explicit zeroes in a reviewer-supplied synthetic fixture; production
  // inputs must come from individually reviewed fields, never these defaults.
  for (const field of names) {
    if (!administrative.has(field)) fields[field] = "0.00";
  }
  Object.assign(fields, {
    TIN: tax, BRANCH_CODE: "0000", LAST_NAME: "SANTOS",
    FIRST_NAME: "MARIA", MIDDLE_NAME: "",
    REGION_NUM: "0001", EMPLOYMENT_FROM: "01/01/2026",
    EMPLOYMENT_TO: "12/31/2026", NATIONALITY: "FILIPINO",
    EMPLOYMENT_STATUS: "01", REASON_SEPARATION: "00",
    GROSS_COMP_INCOME: "600000.00",
    NET_TAXABLE_COMP_INCOME: "500000.00",
    TAX_DUE: String(withheld), ACTUAL_AMT_WTHLD: String(withheld),
    PREV_TAX_WTHLD: "0.00", PRES_TAX_WTHLD: String(withheld),
  });
  if (schedule === "D2") fields.FACTOR_USED = 313;
  return { schedule, fields };
}

test("RMC 25-2024 1604-C schedule and controls keep exact field counts", () => {
  assert.equal(BIR_1604C_D1_FIELDS.length, 47);
  assert.equal(BIR_1604C_D2_FIELDS.length, 56);
  assert.equal(BIR_1604C_C1_FIELDS.length, 35);
  assert.equal(BIR_1604C_C2_FIELDS.length, 43);
  assert.equal(BIR_1604C_D1_FIELDS[0], "SCHEDULE_NUM");
  assert.equal(BIR_1604C_D1_FIELDS[46], "REASON_SEPARATION");
  assert.equal(BIR_1604C_D2_FIELDS[55], "REASON_SEPARATION");
});

test("complete synthetic D1+D2 sample produces H/D1/D2/C1/C2 candidate for external validation", () => {
  const result = buildBir1604cDatCandidate({
    employerTin: "123456789", employerBranch: "0000", taxYear: 2026,
    records: [complete("D1","333222111",5000),complete("D2","333222112",0)],
    expectedEmployees: 2, expectedActualWithheld: "5000.00",
  });
  assert.equal(result.validatedByBir, false);
  assert.equal(result.officialNameConvention, "1234567890000123120261604C.DAT");
  assert.match(result.candidateFilename, /^DRAFT-UNVALIDATED-/);
  const lines = result.content.trim().split("\r\n");
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith("H1604C,"));
  assert.ok(lines[1].startsWith("D1,"));
  assert.ok(lines[2].startsWith("D2,"));
  assert.ok(lines[3].startsWith("C1,"));
  assert.ok(lines[4].startsWith("C2,"));
  assert.equal(lines[1].split(",").length, 47);
  assert.equal(lines[2].split(",").length, 56);
  assert.equal(lines[3].split(",").length, 35);
  assert.equal(lines[4].split(",").length, 43);
});

test("DAT generator refuses fabricated zeros, wrong legal identity and mismatched tax", () => {
  const row = complete("D1","333222111",5000);
  delete row.fields.PREV_NONTAX_13TH_MONTH;
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[row], expectedEmployees:1, expectedActualWithheld:5000,
  }), /Missing reviewed 1604-C field PREV_NONTAX_13TH_MONTH/);
  const full = complete("D1","333222111",5000);
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[full], expectedEmployees:1, expectedActualWithheld:0,
  }), /does not reconcile/);
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[full,full], expectedEmployees:2, expectedActualWithheld:10000,
  }), /Duplicate employee TIN/);
});

test("DAT candidate blocks CRLF, invalid branch, names beyond BIR width, and bad calendar date", () => {
  const fields = complete("D1","333222111",5000);
  fields.fields.LAST_NAME = "SANTOS\nH1604C";
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[fields], expectedEmployees:1, expectedActualWithheld:5000,
  }), /non-ASCII text or a line break/);
  fields.fields.LAST_NAME = "A".repeat(31);
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[fields], expectedEmployees:1, expectedActualWithheld:5000,
  }), /at most 30 characters/);
  fields.fields.LAST_NAME = "SANTOS";
  fields.fields.EMPLOYMENT_FROM = "02/30/2026";
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[fields], expectedEmployees:1, expectedActualWithheld:5000,
  }), /Invalid calendar date/);
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"001", taxYear:2026,
    records:[complete("D1","333222111",5000)], expectedEmployees:1, expectedActualWithheld:5000,
  }), /4 digits/);
});

test("serializer never silently fills missing previous employer or MWE statutory components", () => {
  const mwe = complete("D2","333222111",0);
  delete mwe.fields.PRES_NONTAX_NIGHT_DIFF;
  assert.throws(() => buildBir1604cDatCandidate({
    employerTin:"123456789", employerBranch:"0000", taxYear:2026,
    records:[mwe], expectedEmployees:1, expectedActualWithheld:0,
  }), /Missing reviewed 1604-C field PRES_NONTAX_NIGHT_DIFF/);
});
