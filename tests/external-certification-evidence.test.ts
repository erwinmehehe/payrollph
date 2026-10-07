import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateExternalCertificationEvidence,
  REQUIRED_GOVERNMENT_FILINGS,
  type EvidenceDocument,
  type EvidenceKind,
  type ExternalCertificationManifest,
} from "../src/lib/external-certification-evidence";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "linaw-external-cert-validation-"));
  const docs: EvidenceDocument[] = [];
  const employer = "PH-EMPLOYER-GOLDEN";
  function add(id: string, kind: EvidenceKind, issuer = "Independent External Reviewer") {
    const data = "SYNTHETIC UNIT TEST ONLY - " + id;
    const filePath = id + ".txt";
    writeFileSync(join(root, filePath), data);
    docs.push({
      id, kind, issuer, filePath,
      legalEntityCode: employer,
      sha256: createHash("sha256").update(data).digest("hex"),
      externalReference: "INTERNAL-UNIT-TEST-" + id,
      issuedAt: "2026-01-01",
    });
    return id;
  }

  const reviewer = add("reviewer-approved-file", "independent-review", "Independent PH CPA");
  const license = add("reviewer-license-verification", "professional-license", "Professional Regulation Commission");
  const cycles = ["2026-07", "2026-08"].map((period, index) => {
    const key = "cycle-" + index;
    return {
      period,
      incumbentId: add(key + "-incumbent-report", "incumbent-payroll", "Independent Incumbent Provider"),
      linawId: add(key + "-linaw-report", "linaw-payroll", "Payroll Operations"),
      varianceId: add(key + "-variance-reconciliation", "variance-analysis", "Independent Payroll Analyst"),
      checkerSignoffId: add(key + "-checker-approval", "independent-checker", "Independent Checker"),
    };
  });
  const governmentFilings = REQUIRED_GOVERNMENT_FILINGS.map((entry, index) => {
    const [agency, form] = entry.split(":");
    const key = "agency-" + index;
    return {
      agency: agency as "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG",
      form,
      submissionId: add(key + "-submission", "government-submission", "Employer Payroll Operations"),
      acceptanceId: add(key + "-acceptance-receipt", "government-receipt", agency),
    };
  });
  const manifest: ExternalCertificationManifest = {
    schemaVersion: 1,
    legalEntityCode: employer,
    documents: docs,
    independentReview: { reviewId: reviewer, professionalLicenseId: license },
    parallelCycles: cycles,
    governmentFilings,
    bankUat: {
      bankName: "Accredited Bank Name",
      acceptedTransferId: add("bank-accepted-transfer", "bank-accepted-test", "Accredited Bank"),
      rejectedTransferId: add("bank-rejected-transfer", "bank-rejected-test", "Accredited Bank"),
    },
  };
  return { root, manifest };
}

function withFixture(fn: (root: string, manifest: ExternalCertificationManifest) => void) {
  const { root, manifest } = fixture();
  try { fn(root, manifest); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("structurally complete synthetic proof package is never automatically certified", () => {
  withFixture((root, manifest) => {
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.equal(report.status, "package-ready-for-human-verification");
    assert.equal(report.issues.length, 0);
    assert.equal(report.checkedDocumentCount, report.verifiedFileHashCount);
    assert.equal(report.parallelCycleCount, 2);
    assert.match(report.disclaimer, /does not authenticate|do not authenticate/);
    assert.ok(!JSON.stringify(report).includes('"status":"certified"'));
  });
});

test("tampered evidence hashes fail closed", () => {
  withFixture((root, manifest) => {
    manifest.documents[0].sha256 = "0".repeat(64);
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.equal(report.status, "evidence-incomplete");
    assert.ok(report.issues.some((reason) => reason.includes("SHA-256 mismatch")));
  });
});

test("single employer parallel cycle is insufficient", () => {
  withFixture((root, manifest) => {
    manifest.parallelCycles.pop();
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("At least two distinct")));
  });
});

test("duplicate periods are not two real parallel payroll cycles", () => {
  withFixture((root, manifest) => {
    manifest.parallelCycles[1].period = manifest.parallelCycles[0].period;
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("distinct YYYY-MM")));
  });
});

test("legal employer scope cannot be mixed in one certification bundle", () => {
  withFixture((root, manifest) => {
    manifest.documents[0].legalEntityCode = "OTHER-EMPLOYER";
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("different legal employer")));
  });
});

test("every government filing acceptance requires an actual receipt", () => {
  withFixture((root, manifest) => {
    manifest.governmentFilings.pop();
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("Missing real government acceptance")));
  });
});

test("a payroll vendor cannot self-issue its external CPA or bank proof", () => {
  withFixture((root, manifest) => {
    manifest.documents.find((doc) => doc.kind === "independent-review")!.issuer = "PayrollPH";
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("cannot be issued by PayrollPH")));
  });
});

test("placeholders and absent government references cannot pass", () => {
  withFixture((root, manifest) => {
    manifest.documents.find((doc) => doc.kind === "government-receipt")!.externalReference = "TODO";
    const report = evaluateExternalCertificationEvidence(manifest, root);
    assert.ok(report.issues.some((reason) => reason.includes("placeholder")));
  });
});

test("symlink escapes outside private root are rejected", () => {
  withFixture((root, manifest) => {
    const outside = mkdtempSync(join(tmpdir(), "linaw-outside-proof-"));
    try {
      const doc = manifest.documents[0];
      writeFileSync(join(outside, "outside.txt"), "outside file");
      rmSync(join(root, doc.filePath));
      symlinkSync(join(outside, "outside.txt"), join(root, doc.filePath));
      const report = evaluateExternalCertificationEvidence(manifest, root);
      assert.ok(report.issues.some((reason) => reason.includes("file escapes private evidence root")));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
