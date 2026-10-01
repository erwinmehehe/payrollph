import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BIR_1604C_GENERATOR_VERSION,
  describeEvidenceGap,
  FILING_FORMS,
  SSS_R3_GENERATOR_VERSION,
  findFilingForm,
  parseFilingOutcome,
  provesFileFormat,
  sha256Hex,
  summarizeFilingEvidence,
  type FilingEvidenceRow,
} from "../src/lib/filing-evidence";

const SSS = FILING_FORMS[0];
const NOW = new Date("2026-10-15T00:00:00Z");

const accepted = (overrides: Partial<FilingEvidenceRow> = {}): FilingEvidenceRow => ({
  agency: "SSS",
  form: "R-3",
  status: "accepted",
  submissionMethod: "file_upload",
  generatorVersion: SSS_R3_GENERATOR_VERSION,
  agencyReference: "PRN-1234567",
  periodLabel: "Sep 2026",
  submittedAt: new Date("2026-10-10T00:00:00Z"),
  ...overrides,
});

test("only an uploaded file in today's layout counts as proof the format works", () => {
  assert.equal(provesFileFormat(accepted(), SSS), true);
  assert.equal(provesFileFormat(accepted({ submissionMethod: "manual_entry" }), SSS), false, "retyping proves a filing, not the file");
  assert.equal(provesFileFormat(accepted({ generatorVersion: "sss-r3-worksheet-v0" }), SSS), false, "an older layout says nothing about this one");
  assert.equal(provesFileFormat(accepted({ status: "generated" }), SSS), false, "a record nobody resolved is not evidence");
  assert.equal(provesFileFormat(accepted({ status: "rejected" }), SSS), false);
  assert.equal(provesFileFormat(accepted({ agency: "BIR" }), SSS), false, "another agency's acceptance does not carry over");
  assert.equal(provesFileFormat(accepted({ form: "R-5" }), SSS), false);
});

test("the summary separates real proof from weaker evidence so the scorecard can say which", () => {
  const empty = summarizeFilingEvidence([], SSS);
  assert.equal(empty.proven, false);
  assert.equal(empty.latest, null);

  const weak = summarizeFilingEvidence([
    accepted({ submissionMethod: "manual_entry" }),
    accepted({ generatorVersion: "sss-r3-worksheet-v0" }),
    accepted({ status: "rejected" }),
  ], SSS);
  assert.equal(weak.proven, false, "none of these may count");
  assert.equal(weak.acceptedByManualEntry, 1);
  assert.equal(weak.acceptedOnOlderLayout, 1);
  assert.equal(weak.rejected, 1);

  const strong = summarizeFilingEvidence([
    accepted({ periodLabel: "Aug 2026", agencyReference: "PRN-OLD0001", submittedAt: new Date("2026-09-10T00:00:00Z") }),
    accepted(),
  ], SSS);
  assert.equal(strong.proven, true);
  assert.equal(strong.provingCount, 2);
  assert.deepEqual(strong.latest, { periodLabel: "Sep 2026", agencyReference: "PRN-1234567" }, "latest means most recently submitted");
});

test("an acceptance needs the agency's reference, a method and a real, non-future date", () => {
  const good = { outcome: "accepted", submissionMethod: "file_upload", agencyReference: "PRN 1234567", submittedAt: "2026-10-10" };
  const parsed = parseFilingOutcome(good, NOW);
  assert.ok(parsed.ok);
  assert.equal(parsed.ok && parsed.value.outcome, "accepted");

  for (const [change, expected] of [
    [{ agencyReference: "" }, /agency's own reference/],
    [{ agencyReference: "abc" }, /agency's own reference/],
    [{ agencyReference: "<script>alert(1)</script>" }, /agency's own reference/],
    [{ submittedAt: "" }, /date it was submitted/],
    [{ submittedAt: "not a date" }, /not a valid date/],
    [{ submittedAt: "2026-12-31" }, /future/],
    [{ submissionMethod: "email" }, /submissionMethod/],
    [{ outcome: "maybe" }, /outcome must be/],
  ] as const) {
    const result = parseFilingOutcome({ ...good, ...change }, NOW);
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.match(!result.ok ? result.error : "", expected);
  }
  assert.equal(parseFilingOutcome(null, NOW).ok, false);
});

test("a rejection must say what was wrong, but needs no reference", () => {
  assert.equal(parseFilingOutcome({ outcome: "rejected", submissionMethod: "file_upload" }, NOW).ok, false);
  const result = parseFilingOutcome({ outcome: "rejected", submissionMethod: "file_upload", note: "Column MSC not recognised" }, NOW);
  assert.ok(result.ok);
  assert.equal(result.ok && result.value.agencyReference, null);
});

test("the file hash is stable and sensitive to a single changed byte", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(sha256Hex("SSSNo,1"), sha256Hex("SSSNo,2"));
});

test("only forms Linaw actually generates can be tracked", () => {
  assert.equal(findFilingForm("SSS", "R-3")?.kind, "sss-r3");
  assert.equal(findFilingForm("BIR", "1601-C"), null, "no evidence rows for a form with no evidence flow yet");
  assert.equal(findFilingForm("PhilHealth", "RF-1"), null);
  assert.equal(findFilingForm("BIR", "1604-C")?.kind, "bir-1604c-source");
  assert.equal(findFilingForm(undefined, undefined), null);
});

test("changing a tracked file's columns forces a generator version bump", () => {
  // Acceptance of one layout says nothing about another. If this fails you changed
  // a header: bump that form's generator version in src/lib/filing-evidence.ts, then
  // update the pin. Old acceptances then stop counting toward readiness, which is the point.
  const source = readFileSync("src/lib/exporters.ts", "utf8");
  const pins = [
    { form: "SSS R-3", pattern: /"(SSSNo,LastName[^"]+)"/, version: SSS_R3_GENERATOR_VERSION, expected: "sss-r3-worksheet-v1|SSSNo,LastName,FirstName,MiddleName,MSC,SS_Regular,SS_MPF,SS_Employee,SS_Employer,EC_Employer,Total_Contribution" },
    { form: "BIR 1604-C", pattern: /"(EmployerTIN,EmployerBranchCode[^"]+)"/, version: BIR_1604C_GENERATOR_VERSION, expected: "bir-1604c-source-v1|EmployerTIN,EmployerBranchCode,EmployeeTIN,EmployeeBranchCode,LastName,FirstName,MiddleName,Nationality,GrossCompensation,TaxWithheld,MWE,Status" },
  ];
  for (const pin of pins) {
    const header = source.match(pin.pattern)?.[1];
    assert.ok(header, `could not find the ${pin.form} header line`);
    assert.equal(sha256Hex(`${pin.version}|${header}`), sha256Hex(pin.expected), `${pin.form} columns changed without a version bump`);
  }
});

test("BIR evidence follows the same rules and never borrows SSS's acceptance", () => {
  const bir = findFilingForm("BIR", "1604-C")!;
  assert.equal(bir.kind, "bir-1604c-source");
  const row = (overrides: Partial<FilingEvidenceRow> = {}) =>
    accepted({ agency: "BIR", form: "1604-C", generatorVersion: BIR_1604C_GENERATOR_VERSION, agencyReference: "TKT-2026-0001", ...overrides });
  assert.equal(provesFileFormat(row(), bir), true);
  assert.equal(provesFileFormat(row({ submissionMethod: "manual_entry" }), bir), false);
  assert.equal(provesFileFormat(row({ generatorVersion: "bir-1604c-source-v0" }), bir), false);
  assert.equal(provesFileFormat(accepted(), bir), false, "an SSS acceptance must not turn on the BIR gate");
  assert.equal(provesFileFormat(row(), SSS), false, "a BIR acceptance must not turn on the SSS gate");
  assert.equal(summarizeFilingEvidence([accepted()], bir).proven, false);
});

test("the gap explanation names weaker evidence without counting it", () => {
  const bir = findFilingForm("BIR", "1604-C")!;
  assert.match(describeEvidenceGap(summarizeFilingEvidence([], bir), bir), /No recorded BIR acceptance/);
  const weak = describeEvidenceGap(summarizeFilingEvidence([
    accepted({ agency: "BIR", form: "1604-C", submissionMethod: "manual_entry" }),
    accepted({ agency: "BIR", form: "1604-C", status: "rejected" }),
  ], bir), bir);
  assert.match(weak, /1 filing\(s\) were typed in by hand/);
  assert.match(weak, /1 rejection\(s\) are recorded/);
  assert.ok(!weak.includes(String.fromCharCode(0x2014)));
});

test("readiness reads recorded evidence and no longer trusts an environment flag", () => {
  const readiness = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(readiness.includes("filingEvidenceSummaries"));
  assert.ok(!readiness.includes('enabled("SSS_R3_VALIDATED")'), "SSS_R3_VALIDATED must not decide readiness any more");
  assert.ok(!readiness.includes('enabled("BIR_ALPHALIST_VALIDATED")'), "BIR_ALPHALIST_VALIDATED must not decide readiness any more");
  assert.ok(readiness.includes("filingEvidenceError"), "a missing table must read as not proven, not crash readiness");
});

test("the routes enforce origin, role, MFA on acceptance, and file integrity", () => {
  const list = readFileSync("src/app/api/compliance/filing-validations/route.ts", "utf8");
  const resolve = readFileSync("src/app/api/compliance/filing-validations/[id]/route.ts", "utf8");
  const file = readFileSync("src/app/api/compliance/filing-validations/[id]/file/route.ts", "utf8");

  for (const source of [list, resolve, file]) assert.ok(source.includes("assertOrganizationRole"), "every route must check the workspace role");
  for (const source of [list, resolve]) {
    assert.ok(source.includes("enforceSameOriginMutation"));
    assert.ok(source.includes("publicDemoMutationDenied"), "the shared public demo must not write evidence");
  }
  assert.ok(resolve.includes("requireSensitiveActionMfa"));
  assert.ok(resolve.includes("parseFilingOutcome"));
  assert.ok(file.includes("regenerateRecordedFile"), "the download must be checked against the recorded hash");
  assert.ok(list.includes("organizationId, "), "the payroll run must be looked up inside the caller's workspace");
});

test("the table exists in the schema, the migration, the baseline and the production compat upgrade", () => {
  for (const [path, fragment] of [
    ["src/db/schema.ts", 'pgTable(\n  "government_filing_validations"'],
    ["drizzle/0005_government_filing_validations.sql", "CREATE TABLE IF NOT EXISTS government_filing_validations"],
    ["drizzle/baseline.sql", "CREATE TABLE IF NOT EXISTS government_filing_validations"],
    ["src/lib/core-schema-compat.ts", "CREATE TABLE IF NOT EXISTS government_filing_validations"],
  ] as const) {
    assert.ok(readFileSync(path, "utf8").replace(/\r\n/g, "\n").includes(fragment), `${path} is missing the filing evidence table`);
  }
});
