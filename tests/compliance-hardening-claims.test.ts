import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("remittance calendar does not invent one universal government deadline", () => {
  const source = read("src/lib/ph-compliance.ts");
  assert.ok(!source.includes("STATUTORY_REMITTANCE_DUE_DAY"));
  assert.ok(!source.includes("function statutoryDueDate("));
  assert.ok(source.includes("Government remittance deadlines are intentionally NOT reduced to one date"));
});

test("offboarding 2316 is MFA protected, release-bound and not persisted as plaintext", () => {
  const source = read("src/app/api/separation/[id]/2316/route.ts");
  assert.ok(source.includes("requireSensitiveActionMfa"));
  assert.ok(source.includes('separation.status !== "released"'));
  assert.ok(source.includes("decryptGovernmentId"));
  assert.ok(source.includes("renderForm2316"));
  assert.ok(source.includes('"Cache-Control": "no-store, private"'));
  assert.ok(source.includes("plaintextCertificatePersisted: false"));
  assert.ok(!source.includes("db.insert(documents)"));
});

test("public capability scorecard does not overclaim statutory certification or absolute IDOR safety", () => {
  const source = read("src/lib/capabilities.ts");
  assert.ok(source.includes('SSS / PhilHealth / Pag-IBIG / TRAIN engine", linaw: "partial"'));
  assert.ok(source.includes('MWE exemption handling", linaw: "partial"'));
  assert.ok(source.includes('Year-end annualization + 2316 draft", linaw: "partial"'));
  assert.ok(source.includes("Tenant-scoped authorization"));
  assert.ok(!source.includes("IDOR-safe"));
  assert.ok(source.includes("independent production sign-off still required"));
});

test("government identifiers are masked to browsers and payout changes require recent MFA", () => {
  const source = read("src/app/api/employees/route.ts");
  for (const field of ["tin", "tinBranchCode", "sssNo", "philHealthNo", "pagIbigNo"]) {
    assert.ok(source.includes(`${field}: maskGovernmentId`), `${field} must be masked in API responses`);
  }
  assert.ok(source.includes("if (wantsPayoutUpdate)"));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
});

test("data-subject completion requires fulfillment evidence instead of status-only closure", () => {
  const source = read("src/app/api/compliance/data-requests/route.ts");
  assert.ok(source.includes("internal service-level target"));
  assert.ok(source.includes("fulfillmentEvidence"));
  assert.ok(source.includes("Generate the subject access/portability export before marking this request completed."));
  assert.ok(source.includes("require a fulfillment action and evidence before completion"));
});


test("contractor EWT is a separate BIR workflow rather than freelancer-income-tax logic", () => {
  const source = read("src/app/api/contractors/payments/route.ts");
  assert.ok(source.includes('"0619-E"'));
  assert.ok(source.includes('"1601-EQ"'));
  assert.ok(source.includes("withholdingAtc"));
  assert.ok(source.includes("withholdingRate"));
  assert.ok(source.includes("filingReady: false"));
  assert.ok(source.includes("NOT A BIR IMPORTABLE/FILED RETURN"));
});

test("employee payslip UX uses legal employer name and true calendar-year YTD", () => {
  const detail = read("src/app/api/self/payslips/[id]/route.ts");
  const list = read("src/app/api/self/payslips/route.ts");
  assert.ok(detail.includes("organization?.legalName ?? organization?.name ?? \"Employer\""));
  assert.ok(list.includes("currentTaxYear"));
  assert.ok(list.includes("releasedThisYear"));
  assert.ok(list.includes("periodsPaid: releasedThisYear.length"));
});

test("statutory cutoff timing is explicitly configurable at organization level", () => {
  const source = read("src/app/api/organizations/route.ts");
  assert.ok(source.includes("statutoryDeductionTiming"));
  for (const mode of ["split", "first_cutoff", "second_cutoff"]) {
    assert.ok(source.includes(`\"${mode}\"`));
  }
});


test("year-end tax exports require recent MFA and do not persist plaintext TIN certificates", () => {
  const source = read("src/app/api/year-end/route.ts");
  assert.ok(source.includes('format === "2316" || format === "alphalist"'));
  assert.ok(source.includes("requireSensitiveActionMfa(user)"));
  assert.ok(source.includes('"Cache-Control": "no-store, private"'));
  assert.ok(source.includes('certificateStorage: "not-persisted"'));
  assert.ok(source.includes("plaintextCertificatePersisted: false"));
  assert.ok(!source.includes("db.insert(documents)"));
});


test("company-wide tax and contractor surfaces reject unit-scoped memberships", () => {
  for (const path of [
    "src/app/api/year-end/route.ts",
    "src/app/api/compliance/validate/route.ts",
    "src/app/api/contractors/route.ts",
    "src/app/api/contractors/payments/route.ts",
  ]) {
    const source = read(path);
    assert.ok(source.includes("getAccess("), `${path} must resolve organization scope`);
    assert.ok(source.includes("companyWide"), `${path} must reject unit-scoped users`);
  }
});


test("launch readiness blocks on plaintext government identifiers", () => {
  const readiness = read("src/app/api/readiness/route.ts");
  const pilot = read("src/app/api/readiness/pilot-status/route.ts");
  assert.ok(readiness.includes('key: "government-id-encryption"'));
  assert.ok(readiness.includes("governmentIdEncryptionConfigured"));
  assert.ok(readiness.includes("plaintextEmployeeGovernmentIds"));
  assert.ok(readiness.includes("plaintextContractorTins"));
  assert.ok(pilot.includes('"government-id-encryption"'));
});
