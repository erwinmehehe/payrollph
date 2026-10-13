import assert from "node:assert/strict";
import test from "node:test";
import {
  BIR_1604C_LAYOUT, validateBir1604cPreExport, birModuleV70Status,
  buildReviewedBir1604cCandidate,
  type Bir1604CReviewedRecord,
} from "../src/lib/bir-1604c-pre-export";

const ADMIN = new Set([
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR",
  "RETRN_PERIOD", "SEQ_NUM", "TIN", "BRANCH_CODE",
  "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "REGION_NUM",
  "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "NATIONALITY",
  "EMPLOYMENT_STATUS", "REASON_SEPARATION", "SUBS_FILING", "FACTOR_USED",
]);
function employee(schedule: "D1" | "D2" = "D1", employeeNo = "EMP001"): Bir1604CReviewedRecord {
  const fields: Record<string, string | number> = {};
  for (const field of BIR_1604C_LAYOUT[schedule]) {
    if (!ADMIN.has(field.name)) fields[field.name] = "0.00"; // verified synthetic fixture only
  }
  Object.assign(fields, {
    TIN: employeeNo === "EMP001" ? "333222111" : "333222112",
    BRANCH_CODE: "0000", LAST_NAME: "SANTOS", FIRST_NAME: "MARIA",
    MIDDLE_NAME: "", REGION_NUM: "0001",
    EMPLOYMENT_FROM: "01/01/2026", EMPLOYMENT_TO: "12/31/2026",
    NATIONALITY: "FILIPINO", EMPLOYMENT_STATUS: "R",
    REASON_SEPARATION: "NA", SUBS_FILING: "Y",
    ACTUAL_AMT_WTHLD: "5000.00",
    PRES_TAX_WTHLD: "5000.00",
  });
  if (schedule === "D2") fields.FACTOR_USED = "313";
  return { schedule, employeeNo, sourceReference: "fixture-2316-reviewed",
    priorEmployerReview: "none-confirmed",
    ...(schedule === "D2" ? { mwePremiumEvidenceReference: "synthetic-mwe-breakdown" } : {}),
    reviewedBy: "Synthetic Reviewer", fields };
}
function check(rows: Bir1604CReviewedRecord[], amount = "5000.00") {
  return validateBir1604cPreExport({
    taxYear: 2026, employerTin: "123456789", employerBranch: "0000",
    expectedEmployees: rows.length, expectedActualWithheld: amount, records: rows,
  });
}
function has(result: ReturnType<typeof check>, code: string, no?: string) {
  return result.issues.some(issue => issue.code === code && (!no || issue.employeeNo === no));
}
test("layout pins all four 1604-C detail/control record counts, without an ATC", () => {
  assert.equal(BIR_1604C_LAYOUT.D1.length, 49);
  assert.equal(BIR_1604C_LAYOUT.D2.length, 59);
  assert.equal(BIR_1604C_LAYOUT.C1.length, 36);
  assert.equal(BIR_1604C_LAYOUT.C2.length, 45);
  for (const fields of Object.values(BIR_1604C_LAYOUT)) {
    assert.ok(!fields.some(field => /ATC/.test(field.name)));
  }
  assert.equal(BIR_1604C_LAYOUT.D1.find(field => field.name === "TIN")?.width, 9);
  assert.equal(BIR_1604C_LAYOUT.D1.find(field => field.name === "LAST_NAME")?.width, 30);
  assert.equal(BIR_1604C_LAYOUT.D2.find(field => field.name === "PRES_NONTAX_HOLIDAY_PAY")?.width, 14);
});
test("reviewed regular employee is locally complete, not officially validated", () => {
  const result = check([employee()]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.canGenerateCandidate, true);
  assert.equal(birModuleV70Status(), "not run");
});
test("terminated mid-year: reviewed departure date permitted; inconsistent dates fail", () => {
  const departed = employee();
  departed.fields.EMPLOYMENT_TO = "06/30/2026";
  departed.fields.REASON_SEPARATION = "T";
  assert.equal(check([departed]).canGenerateCandidate, true);
  departed.fields.EMPLOYMENT_TO = "02/30/2026";
  assert.ok(has(check([departed]), "INVALID_DATE", "EMP001"));
  departed.fields.EMPLOYMENT_TO = "12/31/2025";
  assert.ok(has(check([departed]), "EMPLOYMENT_INTERVAL", "EMP001"));
});
test("employee transferring between legal employers cannot mix employer identity", () => {
  const moved = employee();
  moved.fields.TIN_EMPYR = "999999999";
  assert.ok(has(check([moved]), "MISMATCHED_EMPLOYER", "EMP001"));
  const other = employee("D1", "EMP002");
  other.fields.TIN = moved.fields.TIN;
  assert.ok(has(check([moved, other], "10000.00"), "DUPLICATE_TIN"));
});
test("minimum-wage earner requires separately reviewed statutory components and factor", () => {
  const mwe = employee("D2");
  assert.equal(check([mwe]).canGenerateCandidate, true);
  delete mwe.fields.PRES_NONTAX_NIGHT_DIFF;
  mwe.fields.FACTOR_USED = "0";
  const result = check([mwe]);
  assert.ok(has(result, "MISSING_FIELD", "EMP001"));
  assert.ok(has(result, "INVALID_FACTOR", "EMP001"));
});
test("13th month above exempt pool cap is not quietly treated as exempt", () => {
  const row = employee();
  row.fields.PREV_NONTAX_13TH_MONTH = "20000.00";
  row.fields.PRES_NONTAX_13TH_MONTH = "90000.00";
  assert.ok(has(check([row]), "THIRTEENTH_EXEMPT_LIMIT", "EMP001"));
});
test("foreign national text is preserved but non-ASCII content is rejected", () => {
  const row = employee();
  row.fields.NATIONALITY = "INDIAN";
  assert.equal(check([row]).canGenerateCandidate, true);
  row.fields.NATIONALITY = "FRANÇAIS";
  assert.ok(has(check([row]), "INVALID_CHARACTERS", "EMP001"));
});
test("missing TIN and missing provenance produce per-employee errors without plaintext identifiers", () => {
  const row = employee();
  delete row.fields.TIN;
  row.sourceReference = "";
  const result = check([row]);
  assert.ok(has(result, "MISSING_FIELD", "EMP001"));
  assert.ok(has(result, "SOURCE_REFERENCE", "EMP001"));
  assert.equal(result.canGenerateCandidate, false);
  assert.ok(!JSON.stringify(result.issues).includes("333222111"));
});
test("withholding control, money precision and duplicated employee numbers fail closed", () => {
  const row = employee();
  row.fields.PRES_NONTAX_DE_MINIMIS = "2.999";
  const other = employee("D1", "EMP001");
  const result = check([row, other], "1.00");
  assert.ok(has(result, "INVALID_AMOUNT", "EMP001"));
  assert.ok(has(result, "DUPLICATE_EMPLOYEE", "EMP001"));
  assert.ok(has(result, "WITHHOLDING_MISMATCH"));
});
test("BIR v7.0 status requires matching file digest and explicit external evidence", () => {
  const digest = "a".repeat(64);
  const evidence = {
    moduleVersion: "7.0", generatedFileSha256: digest,
    validatedFileSha256: digest, outcome: "pass" as const,
    evidenceReference: "manual-validator-screenshot-001",
  };
  assert.equal(birModuleV70Status(evidence), "yes");
  assert.equal(birModuleV70Status({ ...evidence, outcome: "fail" }), "no");
  assert.equal(birModuleV70Status({ ...evidence, validatedFileSha256: "b".repeat(64) }), "not run");
  assert.equal(birModuleV70Status({ ...evidence, moduleVersion: "7.4" }), "not run");
});

test("default-off flag blocks DAT even for reviewed fixtures", () => {
  const row = employee();
  const request = {
    taxYear: 2026, employerTin: "123456789", employerBranch: "0000",
    expectedEmployees: 1, expectedActualWithheld: "5000.00",
    records: [row],
  };
  const disabled = buildReviewedBir1604cCandidate(request, false);
  assert.equal(disabled.ok, false);
  assert.equal(disabled.issues[0].code, "FEATURE_DISABLED");
  assert.equal(disabled.validatedAgainstModuleV70, "not run");
  const enabled = buildReviewedBir1604cCandidate(request, true);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.validatedAgainstModuleV70, "not run");
  if (enabled.ok) assert.match(enabled.candidate.candidateFilename, /^DRAFT-UNVALIDATED-/);
});

test("manual previous-employer declaration and MWE premium evidence fail closed", () => {
  const worker = employee("D1");
  worker.fields.PREV_NONTAX_13TH_MONTH = "2000.00";
  assert.ok(has(check([worker]), "UNVERIFIED_PREVIOUS_EMPLOYER", "EMP001"));
  worker.priorEmployerReview = "form-2316-verified";
  assert.ok(has(check([worker]), "PRIOR_EMPLOYER_EVIDENCE", "EMP001"));
  worker.priorEmployerEvidenceReference = "synthetic-form-2316-from-prior-employer";
  assert.equal(check([worker]).canGenerateCandidate, true);
  const mwe = employee("D2");
  delete mwe.mwePremiumEvidenceReference;
  assert.ok(has(check([mwe]), "MWE_PREMIUM_EVIDENCE", "EMP001"));
});
