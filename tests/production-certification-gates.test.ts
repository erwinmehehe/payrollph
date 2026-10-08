import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  combineProductionCertificationEvidence,
  evaluateOperationalReadiness,
  OPERATIONAL_PROOF_KINDS,
  type OperationalReadinessManifest,
} from "../src/lib/production-certification-gates";
import type { ParallelReconciliationResult } from "../src/lib/private-parallel-payroll-reconciliation";
import type { CertificationEvidenceResult } from "../src/lib/external-certification-evidence";
import type { AcceptanceBindingResult } from "../src/lib/external-acceptance-bindings";

const COMMIT = "a".repeat(40);
const ENTITY = "PAYROLL-PH-EMPLOYER-01";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "payrollph-ga-proof-"));
  const documents = OPERATIONAL_PROOF_KINDS.map((kind) => {
    const filePath = kind + ".txt";
    const body = "SYNTHETIC FILE FOR UNIT TEST ONLY: " + kind;
    writeFileSync(join(root, filePath), body);
    return {
      kind,
      filePath,
      sha256: createHash("sha256").update(body).digest("hex"),
      issuedAt: new Date().toISOString().slice(0, 10),
      issuer: "Document Owner For " + kind,
      independentlyReviewedBy: "Independent Control Reviewer",
    };
  });
  const clock = Date.now();
  const fixedWhen = (minutesAgo: number) => new Date(clock - minutesAgo * 60_000).toISOString();
  const manifest: OperationalReadinessManifest = {
    schemaVersion: 1,
    legalEntityCode: ENTITY,
    engineCommitSha: COMMIT,
    documents,
    recovery: {
      exerciseEnvironment: "isolated-production-like-staging",
      snapshotCapturedAt: fixedWhen(180),
      incidentDeclaredAt: fixedWhen(90),
      restoreVerifiedAt: fixedWhen(60),
      rpoObjectiveMinutes: 120,
      rtoObjectiveMinutes: 60,
      backupEncrypted: true,
      isolatedRestoreConfirmed: true,
      sourceAndRestoreChecksumsMatch: true,
      rollbackSuccessfullyRehearsed: true,
      representativeDatasetPrivacyReviewed: true,
    },
    separationOfDuties: {
      preparedBy: "Operations Preparer",
      independentlyCheckedBy: "External Checker",
      releaseDecisionOwner: "Release Owner",
      reviewedAt: new Date().toISOString().slice(0, 10),
    },
  };
  return { root, manifest };
}

function withFixture(fn: (root: string, manifest: OperationalReadinessManifest) => void) {
  const value = fixture();
  try { fn(value.root, value.manifest); }
  finally { rmSync(value.root, { recursive: true, force: true }); }
}

function parallel(): ParallelReconciliationResult {
  return {
    status: "arithmetic-reconciled-pending-independent-review",
    legalEntityCode: ENTITY,
    cycleCount: 2,
    verifiedFileHashCount: 8,
    issues: [],
    disclaimer: "Arithmetic only.",
    results: ["2026-07", "2026-08"].map((period) => ({
      period,
      incumbentEmployeeCount: 10,
      linawEmployeeCount: 10,
      matchedEmployees: 10,
      incumbentJournalAccounts: 10,
      linawJournalAccounts: 10,
      employeeFieldVarianceCounts: {},
      journalVarianceCounts: { debit: 0, credit: 0 },
    })),
  };
}
function acceptanceBinding(): AcceptanceBindingResult {
  return {
    status: "structurally-bound-pending-authenticity-review",
    gaApproved: false,
    boundPayrollMonths: 2,
    boundGovernmentFilings: 5,
    boundBankCases: 2,
    issues: [],
    disclaimer: "Metadata only; external authenticity requires manual review.",
  };
}

function external(): CertificationEvidenceResult {
  return {
    status: "package-ready-for-human-verification",
    legalEntityCode: ENTITY,
    issues: [],
    checkedDocumentCount: 24,
    parallelCycleCount: 2,
    verifiedFileHashCount: 24,
    disclaimer: "Hash checks only.",
  };
}

test("a structurally complete synthetic package is never automatically GA-certified", () => {
  withFixture((root, manifest) => {
    const operations = evaluateOperationalReadiness(manifest, root, COMMIT);
    assert.equal(operations.status, "operational-evidence-ready-for-human-review");
    assert.equal(operations.verifiedProofCount, OPERATIONAL_PROOF_KINDS.length);
    assert.equal(operations.measuredRpoMinutes, 90);
    assert.equal(operations.measuredRtoMinutes, 30);
    const combined = combineProductionCertificationEvidence({
      parallel: parallel(),
      external: external(),
      operational: operations,
      acceptanceBindings: acceptanceBinding(),
      parallelMonths: ["2026-07", "2026-08"],
      externalMonths: ["2026-07", "2026-08"],
      parallelEmployerCode: ENTITY,
      externalEmployerCode: ENTITY,
      operationalEmployerCode: ENTITY,
      engineCommitSha: COMMIT,
    });
    assert.equal(combined.status, "evidence-ready-for-independent-final-review");
    assert.equal(combined.gaApproved, false);
    assert.equal(combined.acceptanceBindingStatus, "structurally-bound-pending-authenticity-review");
    assert.equal(combined.boundGovernmentFilings, 5);
    assert.equal(combined.boundBankCases, 2);
    assert.equal(combined.issues.length, 0);
    assert.match(combined.disclaimer, /cannot certify/i);
  });
});

test("source SHA and any private operational evidence hash must be exact", () => {
  withFixture((root, manifest) => {
    assert.ok(evaluateOperationalReadiness(manifest, root, "b".repeat(40)).issues
      .some((issue) => issue.includes("exact independently reviewed")));
    manifest.documents[0].sha256 = "0".repeat(64);
    assert.ok(evaluateOperationalReadiness(manifest, root, COMMIT).issues
      .some((issue) => issue.includes("hash mismatch")));
  });
});

test("missing or duplicate proof and symlink escapes fail closed", () => {
  withFixture((root, manifest) => {
    const removed = manifest.documents.pop()!;
    let report = evaluateOperationalReadiness(manifest, root, COMMIT);
    assert.ok(report.issues.some((issue) => issue.includes("Missing operational proof")));
    manifest.documents.push({ ...manifest.documents[0] });
    report = evaluateOperationalReadiness(manifest, root, COMMIT);
    assert.ok(report.issues.some((issue) => issue.includes("Duplicate operational proof")));
    const outside = mkdtempSync(join(tmpdir(), "payrollph-external-proof-"));
    try {
      writeFileSync(join(outside, "outside.txt"), "NOT IN THE PRIVATE VAULT");
      const proof = manifest.documents[0];
      rmSync(join(root, proof.filePath));
      symlinkSync(join(outside, "outside.txt"), join(root, proof.filePath));
      report = evaluateOperationalReadiness(manifest, root, COMMIT);
      assert.ok(report.issues.some((issue) => issue.includes("escapes the private evidence directory")));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    assert.ok(removed);
  });
});

test("false recovery attestations, stale or over-budget recovery block final review", () => {
  withFixture((root, manifest) => {
    manifest.recovery.backupEncrypted = false;
    assert.ok(evaluateOperationalReadiness(manifest, root, COMMIT).issues
      .some((issue) => issue.includes("backupEncrypted")));
    manifest.recovery.backupEncrypted = true;
    manifest.recovery.rtoObjectiveMinutes = 10;
    assert.ok(evaluateOperationalReadiness(manifest, root, COMMIT).issues
      .some((issue) => issue.includes("RTO exceeds")));
    manifest.recovery.rtoObjectiveMinutes = 60;
    manifest.recovery.exerciseEnvironment = "isolated-production-like-staging";
    manifest.recovery.restoreVerifiedAt = "2026-01-01T00:00:00Z";
    assert.ok(evaluateOperationalReadiness(manifest, root, COMMIT).issues
      .some((issue) => issue.includes("Recovery timeline")));
  });
});

test("three distinct named role owners are required; self review fails", () => {
  withFixture((root, manifest) => {
    manifest.separationOfDuties.independentlyCheckedBy = manifest.separationOfDuties.preparedBy;
    const result = evaluateOperationalReadiness(manifest, root, COMMIT);
    assert.ok(result.issues.some((issue) => issue.includes("three distinct named people")));
  });
});

test("10 real matched workers per cycle and identical employer/months are hard gates", () => {
  withFixture((root, manifest) => {
    const ops = evaluateOperationalReadiness(manifest, root, COMMIT);
    const input = {
      parallel: parallel(),
      external: external(),
      operational: ops,
      acceptanceBindings: acceptanceBinding(),
      parallelMonths: ["2026-07", "2026-08"],
      externalMonths: ["2026-07", "2026-09"],
      parallelEmployerCode: ENTITY,
      externalEmployerCode: ENTITY,
      operationalEmployerCode: ENTITY,
      engineCommitSha: COMMIT,
    };
    assert.ok(combineProductionCertificationEvidence(input).issues.some((i) => i.includes("exactly match")));
    input.externalMonths = ["2026-07", "2026-08"];
    input.parallel.results[0].matchedEmployees = 9;
    assert.ok(combineProductionCertificationEvidence(input).issues.some((i) => i.includes("At least 10")));
    input.parallel.results[0].matchedEmployees = 10;
    input.operationalEmployerCode = "OTHER-LEGAL-ENTITY";
    assert.ok(combineProductionCertificationEvidence(input).issues.some((i) => i.includes("identical legal employer")));
  });
});

test("checked-in template remains intentionally incomplete and cannot pass", () => {
  withFixture((root) => {
    const template = JSON.parse(readFileSync("certification/operational-evidence-template.json", "utf8"));
    const report = evaluateOperationalReadiness(template, root, COMMIT);
    assert.equal(report.status, "operational-evidence-incomplete");
    assert.ok(report.issues.length > 0);
  });
});




test("private GA assessor fails closed without a structurally linked acceptance package", () => {
  withFixture((root, manifest) => {
    const operational = evaluateOperationalReadiness(manifest, root, COMMIT);
    const binding = acceptanceBinding();
    binding.status = "binding-blocked";
    binding.issues.push("A government receipt SHA-256 was inconsistent.");
    const result = combineProductionCertificationEvidence({
      parallel: parallel(),
      external: external(),
      operational,
      acceptanceBindings: binding,
      parallelMonths: ["2026-07", "2026-08"],
      externalMonths: ["2026-07", "2026-08"],
      parallelEmployerCode: ENTITY,
      externalEmployerCode: ENTITY,
      operationalEmployerCode: ENTITY,
      engineCommitSha: COMMIT,
    });
    assert.equal(result.status, "blocked");
    assert.equal(result.gaApproved, false);
    assert.ok(result.issues.some((value) => value.includes("Acceptance bindings")));
  });
});

test("GA CLI requires binding manifest as a mandatory sixth argument", () => {
  const cli = readFileSync("scripts/check-production-certification.ts", "utf8");
  const gate = readFileSync("src/lib/production-certification-gates.ts", "utf8");
  assert.ok(cli.includes("args.length !== 6"));
  assert.ok(cli.includes("bindingsManifest: load(bindingsFile)"));
  assert.ok(gate.includes("evaluateExternalAcceptanceBindings"));
  assert.ok(gate.includes('status !== "structurally-bound-pending-authenticity-review"'));
});
