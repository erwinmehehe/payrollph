import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  type ParallelReconciliationResult,
  evaluateParallelPayrollReconciliation,
} from "@/lib/private-parallel-payroll-reconciliation";
import {
  type CertificationEvidenceResult,
  evaluateExternalCertificationEvidence,
} from "@/lib/external-certification-evidence";
import { type AcceptanceBindingResult, evaluateExternalAcceptanceBindings } from "@/lib/external-acceptance-bindings";

/**
 * Private, offline inspection of the last-mile operational package.
 * A digest only verifies bytes, not that a signatory, bank or authority
 * actually issued/accepted the document. Never emit file contents/PII.
 */
export const OPERATIONAL_PROOF_KINDS = [
  "bir-2316-sample-reviewed",
  "filing-format-reviewed",
  "low-value-payout-authorization",
  "negative-and-reversal-uat",
  "encrypted-backup-control",
  "isolated-restore-rehearsal",
  "rollback-rehearsal",
  "security-access-review",
  "privacy-retention-approval",
] as const;

export type OperationalProofKind = (typeof OPERATIONAL_PROOF_KINDS)[number];

export type OperationalProof = {
  kind: OperationalProofKind;
  filePath: string;
  sha256: string;
  issuedAt: string;
  issuer: string;
  independentlyReviewedBy: string;
};

export type OperationalReadinessManifest = {
  schemaVersion: 1;
  legalEntityCode: string;
  engineCommitSha: string;
  documents: OperationalProof[];
  recovery: {
    exerciseEnvironment: "isolated-production-like-staging";
    snapshotCapturedAt: string;
    incidentDeclaredAt: string;
    restoreVerifiedAt: string;
    rpoObjectiveMinutes: number;
    rtoObjectiveMinutes: number;
    backupEncrypted: boolean;
    isolatedRestoreConfirmed: boolean;
    sourceAndRestoreChecksumsMatch: boolean;
    rollbackSuccessfullyRehearsed: boolean;
    representativeDatasetPrivacyReviewed: boolean;
  };
  separationOfDuties: {
    preparedBy: string;
    independentlyCheckedBy: string;
    releaseDecisionOwner: string;
    reviewedAt: string;
  };
};

export type OperationalReadinessResult = {
  status: "operational-evidence-incomplete" | "operational-evidence-ready-for-human-review";
  issues: string[];
  verifiedProofCount: number;
  expectedProofCount: number;
  measuredRpoMinutes: number | null;
  measuredRtoMinutes: number | null;
  disclaimer: string;
};

export type LaunchEvidenceResult = {
  status: "blocked" | "evidence-ready-for-independent-final-review";
  gaApproved: false;
  employerCode: string | null;
  engineCommitSha: string;
  matchingParallelCycles: number;
  minimumMatchedEmployeesPerCycle: number;
  verifiedExternalEvidenceFiles: number;
  verifiedOperationalEvidenceFiles: number;
  acceptanceBindingStatus: AcceptanceBindingResult["status"];
  boundGovernmentFilings: number;
  boundBankCases: number;
  issues: string[];
  disclaimer: string;
};

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{5,47}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DR_AGE_DAYS = 90;
const DISCLAIMER = "Engineering and SHA-256 checks cannot certify statutory correctness, professional signatures, actual government/bank acceptance, production recovery, or GA. Independent sign-off and a recorded release decision are mandatory.";
const required = new Set<string>(OPERATIONAL_PROOF_KINDS);

function asObject(value: unknown): Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function realDate(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString().slice(0, 10) === value
    && parsed <= Date.now()
    ? parsed : null;
}

function instant(value: unknown): number | null {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : null;
}

function distinctName(value: unknown) {
  return typeof value === "string" && value.trim().length >= 3
    && !/^(?:tbd|todo|sample|test|placeholder|unknown)$/i.test(value.trim());
}

export function evaluateOperationalReadiness(
  value: unknown,
  rootDirectory: string,
  expectedEngineCommitSha: string,
): OperationalReadinessResult {
  const issues: string[] = [];
  const manifest = asObject(value);
  if (manifest.schemaVersion !== 1) issues.push("Operational manifest schemaVersion must be 1.");
  if (typeof manifest.legalEntityCode !== "string" || !ENTITY.test(manifest.legalEntityCode)) {
    issues.push("An actual legal employer code is required.");
  }
  if (!COMMIT.test(expectedEngineCommitSha) || manifest.engineCommitSha !== expectedEngineCommitSha) {
    issues.push("Evidence must name the exact independently reviewed 40-character engine commit SHA.");
  }

  let root = "";
  try { root = realpathSync(resolve(rootDirectory)); }
  catch { issues.push("Private evidence root is unavailable."); }

  const docs = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (!Array.isArray(manifest.documents)) issues.push("Operational documents must be an array.");
  const seen = new Set<string>();
  let verifiedProofCount = 0;
  for (const [index, value] of docs.entries()) {
    const proof = asObject(value);
    const kind = typeof proof.kind === "string" ? proof.kind : "";
    if (!required.has(kind)) {
      issues.push("Operational proof " + (index + 1) + " has an unknown kind.");
      continue;
    }
    if (seen.has(kind)) issues.push("Duplicate operational proof: " + kind + ".");
    seen.add(kind);
    if (!distinctName(proof.issuer) || !distinctName(proof.independentlyReviewedBy)
      || String(proof.issuer).trim().toLowerCase() === String(proof.independentlyReviewedBy).trim().toLowerCase()) {
      issues.push(kind + ": separate named document preparer and independent reviewer are required.");
    }
    const issued = realDate(proof.issuedAt);
    if (issued === null) issues.push(kind + ": issue date must be a real nonfuture ISO date.");
    if (typeof proof.sha256 !== "string" || !HASH.test(proof.sha256)) {
      issues.push(kind + ": lowercase SHA-256 is required.");
    }
    const filePath = typeof proof.filePath === "string" ? proof.filePath : "";
    if (!filePath || isAbsolute(filePath)
      || filePath.split(/[\\/]/).includes("..") || filePath.includes("\0")) {
      issues.push(kind + ": unsafe or missing relative proof path.");
      continue;
    }
    if (!root || !HASH.test(String(proof.sha256))) continue;
    try {
      const target = realpathSync(resolve(root, filePath));
      const rel = relative(root, target);
      if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
        issues.push(kind + ": proof escapes the private evidence directory.");
        continue;
      }
      const stats = statSync(target);
      if (!stats.isFile() || stats.size === 0 || stats.size > MAX_BYTES) {
        issues.push(kind + ": proof must be a nonempty regular file no larger than 8 MiB.");
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(target)).digest("hex");
      if (actual !== proof.sha256) issues.push(kind + ": proof hash mismatch.");
      else verifiedProofCount++;
    } catch {
      issues.push(kind + ": proof is missing or unreadable.");
    }
  }
  for (const kind of OPERATIONAL_PROOF_KINDS) {
    if (!seen.has(kind)) issues.push("Missing operational proof: " + kind + ".");
  }

  const recovery = asObject(manifest.recovery);
  if (recovery.exerciseEnvironment !== "isolated-production-like-staging") {
    issues.push("An isolated production-like staging recovery rehearsal is required; synthetic CI is insufficient.");
  }
  const snapshot = instant(recovery.snapshotCapturedAt);
  const incident = instant(recovery.incidentDeclaredAt);
  const restored = instant(recovery.restoreVerifiedAt);
  let measuredRpoMinutes: number | null = null;
  let measuredRtoMinutes: number | null = null;
  if (snapshot === null || incident === null || restored === null
    || snapshot > incident || incident > restored) {
    issues.push("Recovery timeline must include valid chronological snapshot, incident and verified-restore timestamps.");
  } else {
    measuredRpoMinutes = Math.ceil((incident - snapshot) / 60_000);
    measuredRtoMinutes = Math.ceil((restored - incident) / 60_000);
    if (Date.now() - restored > MAX_DR_AGE_DAYS * 86_400_000) {
      issues.push("Production-like DR rehearsal is older than 90 days.");
    }
  }
  const rpoTarget = recovery.rpoObjectiveMinutes;
  const rtoTarget = recovery.rtoObjectiveMinutes;
  if (typeof rpoTarget !== "number" || !Number.isInteger(rpoTarget) || rpoTarget < 0 || rpoTarget > 10_080) {
    issues.push("Document a valid employer-agreed RPO objective in minutes.");
  } else if (measuredRpoMinutes !== null && measuredRpoMinutes > Number(rpoTarget)) {
    issues.push("Measured rehearsal RPO exceeds the agreed objective.");
  }
  if (typeof rtoTarget !== "number" || !Number.isInteger(rtoTarget) || rtoTarget < 1 || rtoTarget > 10_080) {
    issues.push("Document a valid employer-agreed RTO objective in minutes.");
  } else if (measuredRtoMinutes !== null && measuredRtoMinutes > Number(rtoTarget)) {
    issues.push("Measured rehearsal RTO exceeds the agreed objective.");
  }
  for (const field of [
    "backupEncrypted",
    "isolatedRestoreConfirmed",
    "sourceAndRestoreChecksumsMatch",
    "rollbackSuccessfullyRehearsed",
    "representativeDatasetPrivacyReviewed",
  ]) {
    if (recovery[field] !== true) issues.push("Recovery sign-off requires " + field + ".");
  }

  const duties = asObject(manifest.separationOfDuties);
  const names = [
    duties.preparedBy, duties.independentlyCheckedBy, duties.releaseDecisionOwner,
  ];
  if (names.some((name) => !distinctName(name))
    || new Set(names.map((name) => String(name).trim().toLowerCase())).size !== 3) {
    issues.push("Preparation, independent checking and release decision must be assigned to three distinct named people.");
  }
  const reviewedAt = realDate(duties.reviewedAt);
  if (reviewedAt === null) issues.push("A real dated separation-of-duties review is required.");
  else if (restored !== null && reviewedAt + 86_400_000 < restored) {
    issues.push("Independent review predates the recovery rehearsal.");
  }

  return {
    status: issues.length ? "operational-evidence-incomplete" : "operational-evidence-ready-for-human-review",
    issues,
    verifiedProofCount,
    expectedProofCount: OPERATIONAL_PROOF_KINDS.length,
    measuredRpoMinutes,
    measuredRtoMinutes,
    disclaimer: DISCLAIMER,
  };
}

export function combineProductionCertificationEvidence(input: {
  parallel: ParallelReconciliationResult;
  external: CertificationEvidenceResult;
  operational: OperationalReadinessResult;
  acceptanceBindings: AcceptanceBindingResult;
  parallelMonths: string[];
  externalMonths: string[];
  parallelEmployerCode: string;
  externalEmployerCode: string;
  operationalEmployerCode: string;
  engineCommitSha: string;
}): LaunchEvidenceResult {
  const issues = [
    ...input.parallel.issues.map((issue) => "Parallel reconciliation: " + issue),
    ...input.external.issues.map((issue) => "External evidence: " + issue),
    ...input.operational.issues.map((issue) => "Operational evidence: " + issue),
    ...input.acceptanceBindings.issues.map((issue) => "Acceptance bindings: " + issue),
  ];
  if (input.parallel.status !== "arithmetic-reconciled-pending-independent-review") {
    issues.push("Independent parallel reconciliation has not passed.");
  }
  if (input.external.status !== "package-ready-for-human-verification") {
    issues.push("External filing/bank/independent-review evidence is incomplete.");
  }
  if (input.operational.status !== "operational-evidence-ready-for-human-review") {
    issues.push("Operational recovery/security evidence is incomplete.");
  }
  if (input.acceptanceBindings.status !== "structurally-bound-pending-authenticity-review") {
    issues.push("Employer, government, independent reviewer and bank acceptance bindings have not passed.");
  }
  if (!input.parallelEmployerCode
    || input.parallelEmployerCode !== input.externalEmployerCode
    || input.parallelEmployerCode !== input.operationalEmployerCode) {
    issues.push("All evidence bundles must refer to exactly one identical legal employer.");
  }

  const parallelMonths = [...new Set(input.parallelMonths)].sort();
  const externalMonths = [...new Set(input.externalMonths)].sort();
  if (parallelMonths.length < 2
    || parallelMonths.length !== input.parallelMonths.length
    || externalMonths.length !== input.externalMonths.length
    || JSON.stringify(parallelMonths) !== JSON.stringify(externalMonths)) {
    issues.push("Reconciled months must exactly match independently checked external-evidence months.");
  }

  const minimumMatchedEmployeesPerCycle = input.parallel.results.length
    ? Math.min(...input.parallel.results.map((cycle) => cycle.matchedEmployees))
    : 0;
  if (input.parallel.results.length < 2 || minimumMatchedEmployeesPerCycle < 10) {
    issues.push("At least 10 matched real employees in each of two distinct months are required.");
  }
  return {
    status: issues.length ? "blocked" : "evidence-ready-for-independent-final-review",
    gaApproved: false,
    employerCode: input.parallelEmployerCode || null,
    engineCommitSha: input.engineCommitSha,
    matchingParallelCycles: parallelMonths.length,
    minimumMatchedEmployeesPerCycle,
    verifiedExternalEvidenceFiles: input.external.verifiedFileHashCount,
    verifiedOperationalEvidenceFiles: input.operational.verifiedProofCount,
    acceptanceBindingStatus: input.acceptanceBindings.status,
    boundGovernmentFilings: input.acceptanceBindings.boundGovernmentFilings,
    boundBankCases: input.acceptanceBindings.boundBankCases,
    issues,
    disclaimer: DISCLAIMER,
  };
}

function periods(value: unknown, key: "cycles" | "parallelCycles") {
  const rows = asObject(value)[key];
  return Array.isArray(rows) ? rows.map((cycle) => String(asObject(cycle).period ?? "")) : [];
}

export function evaluateProductionCertificationBundle(input: {
  parallelManifest: unknown;
  externalManifest: unknown;
  operationalManifest: unknown;
  bindingsManifest: unknown;
  privateRoot: string;
  expectedEngineCommitSha: string;
}): LaunchEvidenceResult {
  const parallel = evaluateParallelPayrollReconciliation(input.parallelManifest, input.privateRoot);
  const external = evaluateExternalCertificationEvidence(input.externalManifest, input.privateRoot);
  const operational = evaluateOperationalReadiness(
    input.operationalManifest, input.privateRoot, input.expectedEngineCommitSha,
  );
  const acceptanceBindings = evaluateExternalAcceptanceBindings({
    bindings: input.bindingsManifest,
    parallelManifest: input.parallelManifest,
    externalManifest: input.externalManifest,
    parallelReport: parallel,
    externalReport: external,
    expectedEngineCommitSha: input.expectedEngineCommitSha,
  });
  return combineProductionCertificationEvidence({
    parallel,
    external,
    operational,
    acceptanceBindings,
    parallelMonths: periods(input.parallelManifest, "cycles"),
    externalMonths: periods(input.externalManifest, "parallelCycles"),
    parallelEmployerCode: String(asObject(input.parallelManifest).legalEntityCode ?? ""),
    externalEmployerCode: String(asObject(input.externalManifest).legalEntityCode ?? ""),
    operationalEmployerCode: String(asObject(input.operationalManifest).legalEntityCode ?? ""),
    engineCommitSha: input.expectedEngineCommitSha,
  });
}
