import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const REQUIRED_GOVERNMENT_FILINGS = [
  "BIR:1601-C",
  "BIR:Alphalist",
  "SSS:R-3",
  "PhilHealth:EPRS",
  "Pag-IBIG:eSRS/MCRF",
] as const;

export type EvidenceKind =
  | "independent-review"
  | "professional-license"
  | "incumbent-payroll"
  | "linaw-payroll"
  | "variance-analysis"
  | "independent-checker"
  | "government-submission"
  | "government-receipt"
  | "bank-accepted-test"
  | "bank-rejected-test";

export type EvidenceDocument = {
  id: string;
  kind: EvidenceKind;
  legalEntityCode: string;
  filePath: string;
  sha256: string;
  issuer: string;
  externalReference: string;
  issuedAt: string;
};

export type ExternalCertificationManifest = {
  schemaVersion: 1;
  legalEntityCode: string;
  documents: EvidenceDocument[];
  independentReview: { reviewId: string; professionalLicenseId: string };
  parallelCycles: Array<{
    period: string;
    incumbentId: string;
    linawId: string;
    varianceId: string;
    checkerSignoffId: string;
  }>;
  governmentFilings: Array<{
    agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
    form: string;
    submissionId: string;
    acceptanceId: string;
  }>;
  bankUat: { bankName: string; acceptedTransferId: string; rejectedTransferId: string };
};

export type CertificationEvidenceResult = {
  status: "evidence-incomplete" | "package-ready-for-human-verification";
  legalEntityCode: string | null;
  issues: string[];
  checkedDocumentCount: number;
  parallelCycleCount: number;
  verifiedFileHashCount: number;
  disclaimer: string;
};

const DISCLAIMER = "Structural and SHA-256 checks only: they do not authenticate issuers, verify signatures or professional licenses, prove bank/agency acceptance, or certify payroll. Independent human verification remains mandatory.";
const PLACEHOLDER = /^(?:example|sample|placeholder|todo|tbd|test|dummy|fake|n\/a|none)(?:\b|[-_ ])/i;
const VALID_KINDS = new Set<EvidenceKind>([
  "independent-review", "professional-license", "incumbent-payroll",
  "linaw-payroll", "variance-analysis", "independent-checker",
  "government-submission", "government-receipt",
  "bank-accepted-test", "bank-rejected-test",
]);

function nonPlaceholder(value: unknown) {
  return typeof value === "string"
    && value.trim().length >= 6
    && !PLACEHOLDER.test(value.trim())
    && !/[<>]/.test(value);
}

function isValidDate(value: unknown) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
    && Date.parse(value + "T00:00:00Z") <= Date.now();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Validate a private reviewer-submitted manifest; never issue an automatic certification. */
export function evaluateExternalCertificationEvidence(
  value: unknown,
  evidenceRoot: string,
): CertificationEvidenceResult {
  const issues: string[] = [];
  let checkedDocumentCount = 0;
  let verifiedFileHashCount = 0;
  const manifest = isObject(value) ? value : {};
  const legalEntityCode = typeof manifest.legalEntityCode === "string"
    ? manifest.legalEntityCode.trim() : "";

  if (manifest.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (!nonPlaceholder(legalEntityCode)) issues.push("An actual legalEntityCode is required.");

  const root = resolve(evidenceRoot);
  let safeRoot = "";
  try {
    safeRoot = realpathSync(root);
  } catch {
    issues.push("Evidence root does not exist.");
  }

  const docList = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (!Array.isArray(manifest.documents)) issues.push("documents must be an array.");
  const documentMap = new Map<string, EvidenceDocument>();

  for (const [index, raw] of docList.entries()) {
    checkedDocumentCount++;
    if (!isObject(raw)) {
      issues.push("Document " + index + " must be an object.");
      continue;
    }
    const doc = raw as EvidenceDocument;
    if (!nonPlaceholder(doc.id) || documentMap.has(doc.id)) {
      issues.push("Document " + index + " needs a unique real id.");
      continue;
    }
    documentMap.set(doc.id, doc);
    if (!VALID_KINDS.has(doc.kind)) issues.push(doc.id + ": invalid kind.");
    if (doc.legalEntityCode !== legalEntityCode) issues.push(doc.id + ": different legal employer.");
    if (!nonPlaceholder(doc.externalReference)) issues.push(doc.id + ": external reference missing or placeholder.");
    if (!nonPlaceholder(doc.issuer)) issues.push(doc.id + ": issuer missing or placeholder.");
    if (!isValidDate(doc.issuedAt)) issues.push(doc.id + ": issuedAt must be a real, nonfuture ISO date.");
    if (
      ["independent-review", "professional-license", "government-receipt", "bank-accepted-test", "bank-rejected-test"].includes(doc.kind)
      && /\b(?:linaw|payrollph)\b/i.test(doc.issuer ?? "")
    ) {
      issues.push(doc.id + ": external proof cannot be issued by PayrollPH.");
    }
    if (typeof doc.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(doc.sha256)) {
      issues.push(doc.id + ": SHA-256 must be 64 hex characters.");
    }
    if (typeof doc.filePath !== "string" || !doc.filePath || isAbsolute(doc.filePath)) {
      issues.push(doc.id + ": filePath must be relative to the private evidence root.");
      continue;
    }
    if (!safeRoot) continue;
    try {
      const target = realpathSync(resolve(safeRoot, doc.filePath));
      const rel = relative(safeRoot, target);
      if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
        issues.push(doc.id + ": file escapes private evidence root.");
        continue;
      }
      if (!statSync(target).isFile()) {
        issues.push(doc.id + ": evidence is not a regular file.");
        continue;
      }
      const file = readFileSync(target);
      if (file.length === 0) {
        issues.push(doc.id + ": evidence file is empty.");
        continue;
      }
      const actual = createHash("sha256").update(file).digest("hex");
      if (actual !== (doc.sha256 ?? "").toLowerCase()) {
        issues.push(doc.id + ": evidence SHA-256 mismatch.");
      } else {
        verifiedFileHashCount++;
      }
    } catch {
      issues.push(doc.id + ": evidence file is missing or unreadable.");
    }
  }

  function requireDocument(id: unknown, kind: EvidenceKind, context: string) {
    const doc = typeof id === "string" ? documentMap.get(id) : undefined;
    if (!doc || doc.kind !== kind) {
      issues.push(context + ": missing " + kind + " evidence.");
    }
  }

  const review = isObject(manifest.independentReview) ? manifest.independentReview : {};
  requireDocument(review.reviewId, "independent-review", "independentReview");
  requireDocument(review.professionalLicenseId, "professional-license", "independentReview");

  const cycles = Array.isArray(manifest.parallelCycles) ? manifest.parallelCycles : [];
  if (cycles.length < 2) issues.push("At least two distinct REAL employer parallel payroll cycles are required.");
  const periods = new Set<string>();
  for (const [index, cycle] of cycles.entries()) {
    if (!isObject(cycle)) { issues.push("parallelCycles[" + index + "]: invalid."); continue; }
    const label = "parallelCycles[" + index + "]";
    if (typeof cycle.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle.period) || periods.has(cycle.period)) {
      issues.push(label + ": requires a distinct YYYY-MM payroll period.");
    } else periods.add(cycle.period);
    requireDocument(cycle.incumbentId, "incumbent-payroll", label);
    requireDocument(cycle.linawId, "linaw-payroll", label);
    requireDocument(cycle.varianceId, "variance-analysis", label);
    requireDocument(cycle.checkerSignoffId, "independent-checker", label);
  }

  const filings = Array.isArray(manifest.governmentFilings) ? manifest.governmentFilings : [];
  const filingKeys = new Set<string>();
  for (const [index, filing] of filings.entries()) {
    if (!isObject(filing)) { issues.push("governmentFilings[" + index + "]: invalid."); continue; }
    const key = String(filing.agency) + ":" + String(filing.form);
    if (filingKeys.has(key)) issues.push("Duplicate government acceptance: " + key);
    filingKeys.add(key);
    requireDocument(filing.submissionId, "government-submission", key);
    requireDocument(filing.acceptanceId, "government-receipt", key);
  }
  for (const expected of REQUIRED_GOVERNMENT_FILINGS) {
    if (!filingKeys.has(expected)) issues.push("Missing real government acceptance: " + expected);
  }

  const bank = isObject(manifest.bankUat) ? manifest.bankUat : {};
  if (!nonPlaceholder(bank.bankName)) issues.push("bankUat requires the actual bank name.");
  requireDocument(bank.acceptedTransferId, "bank-accepted-test", "bankUat");
  requireDocument(bank.rejectedTransferId, "bank-rejected-test", "bankUat");

  return {
    status: issues.length === 0 ? "package-ready-for-human-verification" : "evidence-incomplete",
    legalEntityCode: legalEntityCode || null,
    issues,
    checkedDocumentCount,
    parallelCycleCount: cycles.length,
    verifiedFileHashCount,
    disclaimer: DISCLAIMER,
  };
}
