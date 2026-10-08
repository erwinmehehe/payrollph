import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateExternalAcceptanceBindings, REQUIRED_ACCEPTANCE_FORMS } from "../src/lib/external-acceptance-bindings";

const EMPLOYER = "SYNTHETIC-EMPLOYER-0001";
const SHA = "a".repeat(40);
const hash = (value: number) => value.toString(16).padStart(64, "0");

function fixture() {
  let index = 0;
  const documents: Array<{
    id: string; kind: string; legalEntityCode: string;
    sha256: string; externalReference: string;
  }> = [];
  function add(kind: string, id: string) {
    const doc = {
      id,
      kind,
      legalEntityCode: EMPLOYER,
      sha256: hash(++index),
      externalReference: "ISSUER-REFERENCE-" + id,
    };
    documents.push(doc);
    return doc;
  }
  const review = add("independent-review", "independent-opinion");
  const license = add("professional-license", "professional-license");
  const filings = REQUIRED_ACCEPTANCE_FORMS.map(({ agency, form }, position) => {
    const submission = add("government-submission", "submission-" + position);
    const receipt = add("government-receipt", "receipt-" + position);
    return {
      external: { agency, form, submissionId: submission.id, acceptanceId: receipt.id },
      binding: {
        agency,
        form,
        submissionId: submission.id,
        submissionSha256: submission.sha256,
        submissionExternalReference: submission.externalReference,
        acceptanceId: receipt.id,
        acceptanceSha256: receipt.sha256,
        acceptanceExternalReference: receipt.externalReference,
      },
    };
  });
  const accepted = add("bank-accepted-test", "accepted-bank-case");
  const rejected = add("bank-rejected-test", "rejected-bank-case");
  return {
    expectedEngineCommitSha: SHA,
    parallelManifest: {
      legalEntityCode: EMPLOYER,
      cycles: [{ period: "2026-07" }, { period: "2026-08" }],
    },
    externalManifest: {
      legalEntityCode: EMPLOYER,
      documents,
      parallelCycles: [{ period: "2026-07" }, { period: "2026-08" }],
      governmentFilings: filings.map(x => x.external),
      independentReview: { reviewId: review.id, professionalLicenseId: license.id },
      bankUat: {
        bankName: "Synthetic Bank",
        acceptedTransferId: accepted.id,
        rejectedTransferId: rejected.id,
      },
    },
    parallelReport: {
      status: "arithmetic-reconciled-pending-independent-review",
      issues: [] as string[],
      results: [
        { period: "2026-07", matchedEmployees: 10 },
        { period: "2026-08", matchedEmployees: 12 },
      ],
    },
    externalReport: {
      status: "package-ready-for-human-verification",
      issues: [] as string[],
    },
    bindings: {
      schemaVersion: 1,
      legalEntityCode: EMPLOYER,
      engineCommitSha: SHA,
      payrollMonths: ["2026-07", "2026-08"],
      independentReview: {
        reviewEvidenceId: review.id,
        reviewSha256: review.sha256,
        licenseEvidenceId: license.id,
        licenseSha256: license.sha256,
      },
      governmentFilings: filings.map(x => x.binding),
      bankUat: {
        bankName: "Synthetic Bank",
        accepted: {
          evidenceId: accepted.id,
          sha256: accepted.sha256,
          externalReference: accepted.externalReference,
        },
        rejected: {
          evidenceId: rejected.id,
          sha256: rejected.sha256,
          externalReference: rejected.externalReference,
        },
      },
    },
  };
}

test("full matching synthetic metadata is bound, never independently certified", () => {
  const output = evaluateExternalAcceptanceBindings(fixture());
  assert.equal(output.status, "structurally-bound-pending-authenticity-review");
  assert.equal(output.gaApproved, false);
  assert.equal(output.boundGovernmentFilings, 5);
  assert.equal(output.boundBankCases, 2);
  assert.equal(output.boundPayrollMonths, 2);
  assert.deepEqual(output.issues, []);
  assert.match(output.disclaimer, /human verification/);
});

test("rejects wrong engine commit even with matching document hashes", () => {
  const data = fixture();
  data.bindings.engineCommitSha = "b".repeat(40);
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("reviewed 40-character") || x.includes("reviewed 40")));
});

test("rejects wrong legal employer", () => {
  const data = fixture();
  data.bindings.legalEntityCode = "DIFFERENT-EMPLOYER-001";
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("same valid legal employer")));
});

test("rejects mismatched source, review and binding payroll periods", () => {
  const data = fixture();
  data.externalManifest.parallelCycles[1].period = "2026-09";
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("match exactly")));
});

test("rejects missing prerequisites and under-ten employee real-month population", () => {
  const data = fixture();
  data.parallelReport.results[1].matchedEmployees = 9;
  data.externalReport.status = "evidence-incomplete";
  const out = evaluateExternalAcceptanceBindings(data);
  assert.ok(out.issues.some(x => x.includes("at least 10 matched") || x.includes("At least 10 matched")));
  assert.ok(out.issues.some(x => x.includes("proof-file hash checks")));
});

test("rejects tampered receipt sha256 and different issuer reference", () => {
  const data = fixture();
  data.bindings.governmentFilings[0].acceptanceSha256 = "c".repeat(64);
  data.bindings.governmentFilings[1].acceptanceExternalReference = "WRONG-PORTAL-REFERENCE";
  const out = evaluateExternalAcceptanceBindings(data);
  assert.ok(out.issues.some(x => x.includes("artifact SHA-256")));
  assert.ok(out.issues.some(x => x.includes("original issuer reference")));
});

test("rejects duplicate government acceptance reuse across form types", () => {
  const data = fixture();
  const original = data.bindings.governmentFilings[0];
  data.bindings.governmentFilings[1].acceptanceId = original.acceptanceId;
  data.bindings.governmentFilings[1].acceptanceSha256 = original.acceptanceSha256;
  data.bindings.governmentFilings[1].acceptanceExternalReference = original.acceptanceExternalReference;
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("reused")));
});

test("rejects duplicate receipt portal references even with different proof IDs", () => {
  const data = fixture();
  data.externalManifest.documents.find(x => x.id === "receipt-1")!.externalReference =
    data.bindings.governmentFilings[0].acceptanceExternalReference;
  data.bindings.governmentFilings[1].acceptanceExternalReference =
    data.bindings.governmentFilings[0].acceptanceExternalReference;
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("reused")));
});

test("rejects wrong accepted and rejected bank evidence IDs", () => {
  const data = fixture();
  data.bindings.bankUat.accepted.evidenceId = data.bindings.bankUat.rejected.evidenceId;
  data.bindings.bankUat.accepted.sha256 = data.bindings.bankUat.rejected.sha256;
  data.bindings.bankUat.accepted.externalReference = data.bindings.bankUat.rejected.externalReference;
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("Bank accepted UAT")));
});

test("rejects mandatory agency missing from private manifest", () => {
  const data = fixture();
  data.bindings.governmentFilings.pop();
  assert.ok(evaluateExternalAcceptanceBindings(data).issues.some(x => x.includes("Exactly five") || x.includes("Missing mandatory")));
});

test("checked-in binding template is intentionally incomplete", () => {
  const data = fixture();
  data.bindings = JSON.parse(readFileSync("certification/acceptance-bindings-template.json", "utf8")) as typeof data.bindings;
  assert.equal(evaluateExternalAcceptanceBindings(data).status, "binding-blocked");
});
