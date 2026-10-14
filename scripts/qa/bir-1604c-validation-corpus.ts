/** FICTIONAL offline format cases. Never use these identities for submission. */
import { createHash } from "node:crypto";
import {
  BIR_1604C_D1_FIELDS, BIR_1604C_D2_FIELDS,
  buildBir1604cDatCandidate, type Bir1604CCandidateInput, type Bir1604CRecord,
} from "../../src/lib/bir-1604c-dat-candidate";

const administrative = new Set([
  "SCHEDULE_NUM", "FTYPE_CODE", "TIN_EMPYR", "BRANCH_CODE_EMPLYR", "RETRN_PERIOD",
  "SEQ_NUM", "TIN", "BRANCH_CODE", "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME",
  "REGION_NUM", "EMPLOYMENT_FROM", "EMPLOYMENT_TO", "NATIONALITY",
  "EMPLOYMENT_STATUS", "REASON_SEPARATION", "SUBS_FILING", "FACTOR_USED",
]);
export function syntheticFilingInput(): Bir1604CCandidateInput {
  const cases = ["REGULAR", "MINIMUMWAGE", "PARTIALYEAR", "PRIOREMPLOYER", "REFUND"];
  const records: Bir1604CRecord[] = cases.map((name, index) => {
    const schedule = index === 1 ? "D2" : "D1";
    const fields: Bir1604CRecord["fields"] = {};
    // Deliberate fixture-only zeros, never a production mapping/default.
    for (const field of schedule === "D1" ? BIR_1604C_D1_FIELDS : BIR_1604C_D2_FIELDS)
      if (!administrative.has(field)) fields[field] = "0.00";
    Object.assign(fields, {
      TIN: "33322211" + index, BRANCH_CODE: "0000", LAST_NAME: name,
      FIRST_NAME: "FICTIONAL", MIDDLE_NAME: "", REGION_NUM: "NCR",
      EMPLOYMENT_FROM: index === 2 ? "07/01/2025" : "01/01/2025",
      EMPLOYMENT_TO: "12/31/2025", NATIONALITY: "FILIPINO",
      EMPLOYMENT_STATUS: "R", REASON_SEPARATION: "NA", SUBS_FILING: index === 3 ? "N" : "Y",
    });
    if (index === 1) Object.assign(fields, {
      FACTOR_USED: 313, PRES_NONTAX_BASIC_SMW_DAY: "500.00",
      PRES_NONTAX_BASIC_SMW_MONTH: "13041.67", PRES_NONTAX_BASIC_SMW_YEAR: "156500.00",
      PRES_NONTAX_GROSS_COMP_INCOME: "156500.00", PRES_TOTAL_NONTAX_COMP_INCOME: "156500.00",
      // Official 7.4 treats this D2 column as combined taxable compensation.
      // Exempt wage amounts remain above and in NONTAX_BASIC_SAL, never erased.
      GROSS_COMP_INCOME: "0.00", NONTAX_BASIC_SAL: "156500.00",
    });
    else {
      const gross = index === 2 ? "300000.00" : "600000.00";
      const tax = index === 2 ? "7500.00" : "62500.00";
      Object.assign(fields, {
        PRES_NONTAX_GROSS_COMP_INCOME: gross, TAX_BASIC_SAL: gross,
        PRES_TOTAL_COMP: gross, GROSS_COMP_INCOME: gross, NET_TAXABLE_COMP_INCOME: gross,
        TAX_DUE: tax, PRES_TAX_WTHLD: tax, ACTUAL_AMT_WTHLD: tax,
      });
      if (index === 3) Object.assign(fields, {
        PREV_TAXABLE_BASIC_SALARY: "300000.00", PREV_TOTAL_TAXABLE: "300000.00",
        PREV_NONTAX_GROSS_COMP_INCOME: "300000.00", TAX_BASIC_SAL: "300000.00",
        PRES_TOTAL_COMP: "300000.00", PRES_NONTAX_GROSS_COMP_INCOME: "300000.00",
        PREV_TAX_WTHLD: "7500.00", PRES_TAX_WTHLD: "55000.00",
      });
      if (index === 4) Object.assign(fields, { PRES_TAX_WTHLD: "63500.00", OVER_WTHLD: "1000.00" });
    }
    return { schedule, fields };
  });
  return { employerTin: "123456789", employerBranch: "0000", taxYear: 2025,
    records, expectedEmployees: records.length, expectedActualWithheld: "195000.00" };
}
export function buildSyntheticValidationCorpus(sourceSha: string) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("Exact source commit required");
  const input = syntheticFilingInput();
  const candidate = buildBir1604cDatCandidate(input);
  const files = [
    { caseId: "ordinary-and-difficult", content: candidate.content,
      expected: "STRUCTURAL_CANDIDATE_ONLY" },
    { caseId: "corrupt-header", content: candidate.content.replace("H1604C", "H9999"), expected: "OFFICIAL_REJECTION_TO_BE_OBSERVED" },
    { caseId: "corrupt-control", content: candidate.content.replace(/C1,/, "C9,"), expected: "OFFICIAL_REJECTION_TO_BE_OBSERVED" },
    { caseId: "wrong-employer-detail", content: candidate.content.replace(/D1,"1604C","123456789"/, 'D1,"1604C","987654321"'), expected: "OFFICIAL_REJECTION_TO_BE_OBSERVED" },
    { caseId: "truncated-file", content: candidate.content.slice(0, candidate.content.indexOf("C1,")), expected: "OFFICIAL_REJECTION_TO_BE_OBSERVED" },
  ].map(item => ({ ...item, filename: item.caseId + "/" + candidate.officialNameConvention,
    sha256: createHash("sha256").update(item.content, "ascii").digest("hex"),
    byteCount: Buffer.byteLength(item.content, "ascii") }));
  return { files, manifest: {
    schemaVersion: 1, sourceSha, scope: "FICTIONAL ONLY — NEVER SUBMIT",
    officialValidatorResult: "NOT_RUN", agencySubmission: "PROHIBITED", independentTaxReview: "NOT_RUN",
    sourceInputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    cases: files.map(({ content: _content, ...metadata }) => metadata),
  } };
}
