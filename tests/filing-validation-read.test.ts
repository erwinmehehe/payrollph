import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseFilingValidationRead } from "../src/lib/filing-validation-read";

const expected = { organizationId: 41, legalEntityId: 7, agency: "BIR", form: "1601-C" };
const form = () => ({
  agency: "BIR", form: "1601-C", generatorVersion: "bir-1601c-monthly-v1",
  referenceLabel: "BIR confirmation", evidenceMode: "operational",
  submissionMethods: ["manual_entry"], requiresFinalCutoff: true,
  official: null, relatedCertificate: null,
  copy: {
    title: "BIR 1601-C", agencyLabel: "BIR", portalLabel: "eFPS",
    methodLabels: { file_upload: "Upload", manual_entry: "Enter" },
    manualEntryNote: "Preserve independent agency evidence.",
    answerLabel: "Confirmation", scopeNote: null,
    unconfirmedNote: "The worksheet is not an official BIR upload.",
  },
});

const filing = () => ({
  id: 23, organizationId: 41, legalEntityId: 7, payrollRunId: 100,
  agency: "BIR", form: "1601-C", periodLabel: "Oct 2026",
  applicableMonth: "2026-10", employeeCount: 3, reportedTotal: "150.00",
  fileName: "fictional.csv", fileSha256: "a".repeat(64),
  generatorVersion: "bir-1601c-monthly-v1", status: "generated",
  submissionMethod: null, agencyReference: null, submittedAt: null,
  outcomeNote: null, generatedBy: "Fictional Admin", recordedBy: null,
  recordedAt: null, createdAt: "2026-10-19T04:20:00.000Z",
});
const response = () => ({
  organizationId: 41, legalEntity: { id: 7, code: "FICT", displayName: "Fictional legal employer" },
  forms: [form()], records: [filing()],
});

test("genuine empty same-employer filing evidence is distinct from missing or malformed success", () => {
  assert.equal(parseFilingValidationRead(response(), expected)?.records.length, 1);
  assert.deepEqual(parseFilingValidationRead({ ...response(), records: [] }, expected)?.records, []);
  // The actual authorized API provides legalEntity.id, not a parent org echo.
  const { organizationId: orgEcho, ...noOrgEcho } = response();
  assert.equal(orgEcho, expected.organizationId);
  assert.deepEqual(parseFilingValidationRead({ ...noOrgEcho, records: [] }, expected)?.records, []);
  assert.equal(parseFilingValidationRead({}, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), records: undefined }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), forms: undefined }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), forms: [] }, expected), null);
});

test("wrong selected organization, wrong legal employer, foreign rows and cross-run duplicates fail closed", () => {
  assert.equal(parseFilingValidationRead(response(), { ...expected, organizationId: 42 }), null);
  assert.equal(parseFilingValidationRead({ ...response(), organizationId: 42 }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), legalEntity: { id: 8, code: "F", displayName: "Other" } }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), records: [{ ...filing(), organizationId: 42 }] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), records: [{ ...filing(), legalEntityId: 8 }] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), records: [filing(), filing()] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), records: [{ ...filing(), payrollRunId: -1 }] }, expected), null);
});

test("invalid money, identity, truncated form definitions and invented acceptance cannot become filing proof", () => {
  for (const changed of [
    { fileSha256: "hash-not-verified" },
    { reportedTotal: "NaN" },
    { employeeCount: -1 },
    { applicableMonth: "2026-13" },
    { status: "accepted", submissionMethod: null, agencyReference: null, submittedAt: null },
    { status: "accepted", submissionMethod: "manual_entry", agencyReference: "ABC", submittedAt: "2026-10-19" },
    { status: "accepted", submissionMethod: "manual_entry", agencyReference: "REF123", submittedAt: null },
  ]) {
    assert.equal(parseFilingValidationRead({ ...response(), records: [{ ...filing(), ...changed }] }, expected), null, JSON.stringify(changed));
  }
  assert.equal(parseFilingValidationRead({ ...response(), forms: [{ ...form(), copy: {} }] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), forms: [{ ...form(), submissionMethods: [] }] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), forms: [form(), form()] }, expected), null);
  assert.equal(parseFilingValidationRead({ ...response(), forms: [{ ...form(), agency: "SSS" }] }, expected), null);

  const accepted = { ...filing(), status: "accepted", submissionMethod: "manual_entry",
    agencyReference: "REF123", submittedAt: "2026-10-19T00:00:00Z" };
  assert.equal(parseFilingValidationRead({ ...response(), records: [accepted] }, expected)?.records[0].status, "accepted");
});

test("the GET echoes the selected organization and the UI gates every filing mutation on a verified response", () => {
  const route = readFileSync("src/app/api/compliance/filing-validations/route.ts", "utf8");
  const client = readFileSync("src/components/workspace/filing-evidence.tsx", "utf8");
  assert.match(route, /assertOrganizationRole\(user\.id, organizationId,/);
  assert.match(route, /assertEntityResource\(context\.context, legalEntity\.id\)/);
  // Parent organization is enforced server-side; every returned row is checked client-side.
  assert.match(client, /parseFilingValidationRead\(payload, \{/);
  assert.match(client, /if \(!verifiedRead\) return;/);
  assert.match(client, /disabled=\{creating \|\| !verifiedRead/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /scopeKey === currentScopeKey/);
  assert.match(client, /Retry evidence read/);
});
