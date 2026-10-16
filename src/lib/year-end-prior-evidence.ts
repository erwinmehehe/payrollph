import { createHash } from "node:crypto";
import { bir2316Centavos } from "./bir-2316-reconciliation";
import { computeAnnualWithholdingTax } from "./payroll-rules";
import type { AnnualizationResult } from "./annualization";

export type PriorEvidence = {
  status: "none-confirmed" | "verified";
  employerName: string;
  employerTin: string;
  periodFrom: string;
  periodTo: string;
  taxableIncome: string;
  taxWithheld: string;
  sourceReference: string;
  sourceSha256: string;
  peraCredit: string;
  peraReference: string;
  peraSha256: string;
};
export type PriorScope = {
  organizationId: number; employeeId: number; taxYear: number;
  legalEntityId: number | null; startDate: string; employeeTin: string | null;
};
export function priorEvidenceDigest(scope: PriorScope, evidence: PriorEvidence) {
  return createHash("sha256").update(JSON.stringify({
    scope: [scope.organizationId, scope.employeeId, scope.taxYear, scope.legalEntityId, scope.startDate, scope.employeeTin],
    evidence: Object.keys(evidence).sort().map(key => [key, evidence[key as keyof PriorEvidence]]),
  })).digest("hex");
}
export function parsePriorEvidence(raw: unknown, scope: PriorScope): PriorEvidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PRIOR_EVIDENCE_INVALID");
  const input = raw as Record<string, unknown>;
  const text = (key: string, max = 160) => {
    if (typeof input[key] !== "string" || input[key].length > max || /[\r\n\x00-\x1f]/.test(input[key])) throw new Error("PRIOR_EVIDENCE_INVALID");
    return input[key].trim();
  };
  const money = (key: string) => {
    const value = text(key, 16), cents = bir2316Centavos(value);
    if (cents === null || cents > 99999999999) throw new Error("PRIOR_EVIDENCE_AMOUNT_INVALID");
    return (cents / 100).toFixed(2);
  };
  if (!Number.isInteger(scope.taxYear) || scope.taxYear < 2023 || scope.taxYear > 2100) throw new Error("PRIOR_EVIDENCE_YEAR_UNSUPPORTED");
  const status = text("status");
  if (status !== "none-confirmed" && status !== "verified") throw new Error("PRIOR_EMPLOYER_REVIEW_REQUIRED");
  const evidence: PriorEvidence = {
    status, employerName: text("employerName"), employerTin: text("employerTin", 16),
    periodFrom: text("periodFrom", 10), periodTo: text("periodTo", 10),
    taxableIncome: money("taxableIncome"), taxWithheld: money("taxWithheld"),
    sourceReference: text("sourceReference"), sourceSha256: text("sourceSha256", 64),
    peraCredit: money("peraCredit"), peraReference: text("peraReference"), peraSha256: text("peraSha256", 64),
  };
  const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!evidence.sourceReference || !hash(evidence.sourceSha256)) throw new Error("PRIOR_SOURCE_EVIDENCE_REQUIRED");
  if (status === "none-confirmed") {
    if (evidence.taxableIncome !== "0.00" || evidence.taxWithheld !== "0.00" || evidence.employerName || evidence.employerTin || evidence.periodFrom || evidence.periodTo) throw new Error("PRIOR_NONE_MUST_BE_ZERO");
  } else {
    if (!evidence.employerName || !/^\d{9}-\d{4}$/.test(evidence.employerTin) || !date(evidence.periodFrom) || !date(evidence.periodTo) ||
      !evidence.periodFrom.startsWith(`${scope.taxYear}-`) || !evidence.periodTo.startsWith(`${scope.taxYear}-`) || evidence.periodTo < evidence.periodFrom || evidence.periodTo >= scope.startDate) throw new Error("PRIOR_SEQUENTIAL_EMPLOYMENT_REQUIRED");
  }
  if (evidence.peraCredit !== "0.00" && (!evidence.peraReference || !hash(evidence.peraSha256))) throw new Error("PERA_EVIDENCE_REQUIRED");
  if (evidence.peraCredit === "0.00" && (evidence.peraReference || evidence.peraSha256)) throw new Error("PERA_ZERO_REFERENCE_INVALID");
  return evidence;
}
export function assertPriorApproval(input: { digest: string; expectedDigest: string; makerId: number; checkerId: number; settled: boolean }) {
  if (input.settled) throw new Error("PRIOR_SETTLED_OR_BOUND");
  if (input.digest !== input.expectedDigest) throw new Error("PRIOR_SOURCE_CHANGED");
  if (input.makerId === input.checkerId) throw new Error("PRIOR_INDEPENDENT_CHECKER_REQUIRED");
}
/** Present-employer gross/withholding remain separate; credits never become WHT. */
export function annualizeWithPrior(present: AnnualizationResult, evidence: PriorEvidence, taxYear: number): AnnualizationResult {
  if (present.mwe) throw new Error("PRIOR_MWE_REVIEW_DEFERRED");
  const cents = (value: string | number) => { const result = bir2316Centavos(value); if (result === null) throw new Error("PRIOR_EVIDENCE_AMOUNT_INVALID"); return result; };
  const combined = cents(present.taxableIncome) + cents(evidence.taxableIncome);
  const due = cents(computeAnnualWithholdingTax(combined / 100, false, `${taxYear}-12-31`));
  const credits = cents(evidence.taxWithheld) + cents(evidence.peraCredit);
  if (cents(evidence.peraCredit) > due) throw new Error("PERA_EXCEEDS_TAX_DUE");
  if (credits > due) throw new Error("PRIOR_CREDITS_EXCEED_TAX_DUE_REVIEW_REQUIRED");
  const adjustment = (due - credits - cents(present.taxWithheld)) / 100;
  return { ...present, taxDue: due / 100, adjustment,
    outcome: adjustment < 0 ? "refund" : adjustment > 0 ? "collect" : "balanced" };
}
