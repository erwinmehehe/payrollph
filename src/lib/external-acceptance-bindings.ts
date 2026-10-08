/**
 * Metadata-level linkage of employer private payroll data, actual filing
 * evidence, bank UAT, independent review, and the reviewed engine commit.
 * This does NOT authenticate agency acknowledgements, banks or signatures.
 * Call independent local hash/parallel validators before using this result.
 */

export const REQUIRED_ACCEPTANCE_FORMS = [
  { agency: "BIR", form: "1601-C" },
  { agency: "BIR", form: "Alphalist" },
  { agency: "SSS", form: "R-3" },
  { agency: "PhilHealth", form: "EPRS" },
  { agency: "Pag-IBIG", form: "eSRS/MCRF" },
] as const;

type SourceDocument = {
  id: string;
  kind: string;
  legalEntityCode: string;
  sha256: string;
  externalReference: string;
};

type FilingBinding = {
  agency: string;
  form: string;
  submissionId: string;
  submissionSha256: string;
  submissionExternalReference: string;
  acceptanceId: string;
  acceptanceSha256: string;
  acceptanceExternalReference: string;
};
type BankCaseBinding = {
  evidenceId: string;
  sha256: string;
  externalReference: string;
};

export type AcceptanceBindingsManifest = {
  schemaVersion: 1;
  legalEntityCode: string;
  engineCommitSha: string;
  payrollMonths: string[];
  independentReview: {
    reviewEvidenceId: string;
    reviewSha256: string;
    licenseEvidenceId: string;
    licenseSha256: string;
  };
  governmentFilings: FilingBinding[];
  bankUat: {
    bankName: string;
    accepted: BankCaseBinding;
    rejected: BankCaseBinding;
  };
};

export type AcceptanceBindingResult = {
  status: "binding-blocked" | "structurally-bound-pending-authenticity-review";
  gaApproved: false;
  boundPayrollMonths: number;
  boundGovernmentFilings: number;
  boundBankCases: number;
  issues: string[];
  disclaimer: string;
};

type ParallelCheck = {
  status: string;
  issues: string[];
  results: Array<{ period: string; matchedEmployees: number }>;
};
type ExternalCheck = { status: string; issues: string[] };

const EMPLOYER = /^[A-Za-z0-9][A-Za-z0-9_-]{5,47}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DISCLAIMER = "Only local metadata and SHA-256 cross-references were checked. Issuer authenticity, actual bank/government acceptance, signed review, statutory compliance and GA require independent human verification.";

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function filingKey(agency: string, form: string) {
  return agency + ":" + form;
}
function months(values: unknown, label: string, issues: string[]) {
  const result = array(values).map(str).sort();
  if (result.length < 2 || result.some(value => !MONTH.test(value))
    || new Set(result).size !== result.length) {
    issues.push(label + " must have at least two distinct valid YYYY-MM months.");
  }
  return result;
}

/**
 * Input reports must come from the existing real-file private validators.
 * The combined GA gate enforces this; a caller passing fabricated reports
 * does not establish evidence authenticity.
 */
export function evaluateExternalAcceptanceBindings(input: {
  bindings: unknown;
  parallelManifest: unknown;
  externalManifest: unknown;
  parallelReport: ParallelCheck;
  externalReport: ExternalCheck;
  expectedEngineCommitSha: string;
}): AcceptanceBindingResult {
  const issues: string[] = [];
  const b = obj(input.bindings);
  const p = obj(input.parallelManifest);
  const e = obj(input.externalManifest);
  const employer = str(b.legalEntityCode);
  if (b.schemaVersion !== 1) issues.push("Acceptance binding schemaVersion must be 1.");
  if (!EMPLOYER.test(employer)
    || str(e.legalEntityCode) !== employer
    || str(p.legalEntityCode) !== employer) {
    issues.push("All three evidence packages must name the same valid legal employer.");
  }
  if (!SHA1.test(input.expectedEngineCommitSha)
    || b.engineCommitSha !== input.expectedEngineCommitSha) {
    issues.push("Acceptance bindings must name the exact reviewed 40-character engine commit.");
  }
  if (!input.parallelReport
    || input.parallelReport.status !== "arithmetic-reconciled-pending-independent-review"
    || !Array.isArray(input.parallelReport.issues) || input.parallelReport.issues.length) {
    issues.push("Actual independent parallel-payroll integrity checks must pass first.");
  }
  if (!input.externalReport
    || input.externalReport.status !== "package-ready-for-human-verification"
    || !Array.isArray(input.externalReport.issues) || input.externalReport.issues.length) {
    issues.push("Actual external proof-file hash checks must pass first.");
  }

  const bindingMonths = months(b.payrollMonths, "Binding months", issues);
  const parallelMonths = months(array(p.cycles).map(v => obj(v).period), "Parallel payroll months", issues);
  const externalMonths = months(array(e.parallelCycles).map(v => obj(v).period), "External review months", issues);
  const resultMonths = months(
    Array.isArray(input.parallelReport?.results) ? input.parallelReport.results.map(v => v.period) : [],
    "Reconciliation result months", issues,
  );
  const sameMonths = (a: string[], z: string[]) => JSON.stringify(a) === JSON.stringify(z);
  if (!sameMonths(bindingMonths, parallelMonths) || !sameMonths(bindingMonths, externalMonths)
    || !sameMonths(bindingMonths, resultMonths)) {
    issues.push("Bindings, source payroll, external review and reconciled months must match exactly.");
  }
  if (input.parallelReport?.results?.some(v =>
    !Number.isInteger(v.matchedEmployees) || v.matchedEmployees < 10
  ) || !Array.isArray(input.parallelReport?.results) || input.parallelReport.results.length < 2) {
    issues.push("At least 10 matched real employees are required in each independently reconciled month.");
  }

  const docs = new Map<string, Record<string, unknown>>();
  for (const item of array(e.documents)) {
    const document = obj(item);
    const id = str(document.id);
    if (!id || docs.has(id)) {
      issues.push("External evidence IDs must be present and unique.");
    } else docs.set(id, document);
  }

  const usedProofIds = new Set<string>();
  function documentMatches(
    label: string, idValue: unknown, hashValue: unknown, expectedKind: string,
    expectedReference?: unknown,
  ): boolean {
    const id = str(idValue);
    const hash = str(hashValue);
    const document = docs.get(id);
    if (!id || !document || str(document.kind) !== expectedKind
      || str(document.legalEntityCode) !== employer) {
      issues.push(label + ": evidence ID, type or employer differs from checked source document.");
      return false;
    }
    if (!SHA256.test(hash) || str(document.sha256) !== hash) {
      issues.push(label + ": artifact SHA-256 differs from verified evidence.");
      return false;
    }
    if (expectedReference !== undefined
      && (!str(expectedReference) || expectedReference !== document.externalReference)) {
      issues.push(label + ": original issuer reference differs from verified evidence.");
      return false;
    }
    if (usedProofIds.has(id)) {
      issues.push(label + ": evidence document was reused across independent sign-offs.");
      return false;
    }
    usedProofIds.add(id);
    return true;
  }

  const review = obj(b.independentReview);
  const checkedReview = obj(e.independentReview);
  documentMatches("Independent professional review", review.reviewEvidenceId, review.reviewSha256, "independent-review");
  documentMatches("Professional license", review.licenseEvidenceId, review.licenseSha256, "professional-license");
  if (review.reviewEvidenceId !== checkedReview.reviewId
    || review.licenseEvidenceId !== checkedReview.professionalLicenseId) {
    issues.push("Independent review IDs do not match the verified certification manifest.");
  }

  const requiredForms: string[] = REQUIRED_ACCEPTANCE_FORMS.map(x => filingKey(x.agency, x.form));
  const sourceForms = new Map<string, Record<string, unknown>>();
  const bindingForms = new Map<string, Record<string, unknown>>();
  function loadForms(collection: unknown, target: Map<string, Record<string, unknown>>, kind: string) {
    for (const item of array(collection)) {
      const data = obj(item);
      const name = filingKey(str(data.agency), str(data.form));
      if (target.has(name)) issues.push("Duplicate " + kind + " agency/form: " + name + ".");
      target.set(name, data);
      if (!requiredForms.includes(name)) issues.push("Unexpected " + kind + " agency/form.");
    }
    if (target.size !== requiredForms.length
      || array(collection).length !== requiredForms.length) {
      issues.push("Exactly five unique mandated " + kind + " agency/form pairs are required.");
    }
  }
  loadForms(e.governmentFilings, sourceForms, "source");
  loadForms(b.governmentFilings, bindingForms, "binding");

  let boundGovernmentFilings = 0;
  const seenReceipts = new Set<string>();
  const seenAgencyReferences = new Set<string>();
  for (const name of requiredForms) {
    const source = sourceForms.get(name);
    const bound = bindingForms.get(name);
    if (!source || !bound) {
      issues.push("Missing mandatory government filing binding: " + name + ".");
      continue;
    }
    const sameIds = bound.submissionId === source.submissionId
      && bound.acceptanceId === source.acceptanceId;
    if (!sameIds) issues.push(name + ": submission or acceptance evidence ID differs from source.");
    const submitted = documentMatches(name + " submission", bound.submissionId, bound.submissionSha256,
      "government-submission", bound.submissionExternalReference);
    const accepted = documentMatches(name + " receipt", bound.acceptanceId, bound.acceptanceSha256,
      "government-receipt", bound.acceptanceExternalReference);
    const receiptId = str(bound.acceptanceId);
    const agencyRef = name.split(":")[0] + ":" + str(bound.acceptanceExternalReference);
    if (!receiptId || !str(bound.acceptanceExternalReference)
      || seenReceipts.has(receiptId) || seenAgencyReferences.has(agencyRef)) {
      issues.push(name + ": reused or missing agency acceptance receipt/reference.");
    }
    seenReceipts.add(receiptId);
    seenAgencyReferences.add(agencyRef);
    if (sameIds && submitted && accepted) boundGovernmentFilings++;
  }

  const bank = obj(b.bankUat);
  const externalBank = obj(e.bankUat);
  if (!str(bank.bankName) || bank.bankName !== externalBank.bankName) {
    issues.push("Bank UAT name differs from externally checked evidence.");
  }
  let boundBankCases = 0;
  const seenBankRefs = new Set<string>();
  const cases = [
    ["accepted", "bank-accepted-test", externalBank.acceptedTransferId],
    ["rejected", "bank-rejected-test", externalBank.rejectedTransferId],
  ] as const;
  for (const [label, kind, externalId] of cases) {
    const given = obj(bank[label]);
    if (given.evidenceId !== externalId) {
      issues.push("Bank " + label + " UAT evidence ID differs from checked source.");
    }
    const ref = str(given.externalReference);
    if (!ref || seenBankRefs.has(ref)) {
      issues.push("Bank " + label + " UAT reference must be unique and nonempty.");
    }
    seenBankRefs.add(ref);
    const matches = documentMatches("Bank " + label + " UAT", given.evidenceId, given.sha256, kind, given.externalReference);
    if (matches && given.evidenceId === externalId) boundBankCases++;
  }

  return {
    status: issues.length ? "binding-blocked" : "structurally-bound-pending-authenticity-review",
    gaApproved: false,
    boundPayrollMonths: bindingMonths.length,
    boundGovernmentFilings,
    boundBankCases,
    issues,
    disclaimer: DISCLAIMER,
  };
}
