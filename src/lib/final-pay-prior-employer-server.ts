/**
 * Reviewed prior-employer tax evidence for separation annualization.
 *
 * BIR RR 11-2018, section 2.79(B)(5)(b), annualized method Steps 1-4:
 * prior employer taxable compensation and withholding must be included at
 * separation. Reuse the encrypted, maker/checker approved Phase 12 evidence.
 * No source amount is accepted from the Separation request body.
 */
import { db } from "@/db";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { assertEntityResource, resolveMultiEntityContext } from "./multi-entity-server";
import { priorEmployeeScope, readPriorEvidence } from "./year-end-prior-evidence-server";
import type { PriorEvidence } from "./year-end-prior-evidence";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = {
  organizationId: number;
  employeeId: number;
  taxYear: number;
  actorUserId: number;
};
export type FinalPayPriorSnapshot = {
  digest: string;
  revision: number;
  taxYear: number;
  status: "verified" | "none-confirmed";
};
export type FinalPayApprovedPrior = {
  evidence: PriorEvidence;
  snapshot: FinalPayPriorSnapshot;
};

/**
 * Flag-OFF means precisely the previous final-pay behavior (no extra read).
 * Flag-ON requires even a full-year/no-prior worker's approved declaration.
 */
export async function loadReviewedPriorForFinalPay(
  input: Scope, tx: Transaction,
): Promise<FinalPayApprovedPrior | null> {
  if (!criticalReleaseFlagEnabled("yearEndPriorEvidence")) return null;
  const actorEntity = await resolveMultiEntityContext({
    userId: input.actorUserId, organizationId: input.organizationId,
  });
  if (!actorEntity.ok || (actorEntity.context.enabled && actorEntity.context.group)) {
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_ENTITY_ACCESS_DENIED");
  }
  const employeeScope = await priorEmployeeScope(tx, input);
  if (actorEntity.context.enabled && assertEntityResource(actorEntity.context, employeeScope.legalEntityId)) {
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_ENTITY_ACCESS_DENIED");
  }
  let current: Awaited<ReturnType<typeof readPriorEvidence>>;
  try {
    current = await readPriorEvidence(tx, employeeScope, true);
  } catch {
    // Do not treat missing, changed, unapproved or undecryptable previous-employer
    // evidence as zero income. A reviewed "none-confirmed" declaration is supported.
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_REQUIRED");
  }
  if (!current) throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_REQUIRED");
  return {
    evidence: current.evidence,
    snapshot: {
      digest: current.row.sourceDigest,
      revision: current.row.revision,
      taxYear: input.taxYear,
      status: current.evidence.status,
    },
  };
}
export function priorEvidenceSnapshot(input: FinalPayApprovedPrior | null): FinalPayPriorSnapshot | null {
  return input?.snapshot ?? null;
}

/**
 * Called under the Separation transaction before initiation, independent
 * approval and manual release. Changes to evidence, scope, flags or approval
 * after preparation invalidate the package; no stale withholding/refund.
 */
export async function assertFinalPayPriorSnapshot(
  input: Scope, recorded: unknown, tx: Transaction,
): Promise<void> {
  let current: FinalPayApprovedPrior | null;
  try {
    current = await loadReviewedPriorForFinalPay(input, tx);
  } catch {
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED");
  }
  if (!current) {
    if (recorded !== null && recorded !== undefined) {
      throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED");
    }
    return;
  }
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) {
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED");
  }
  const frozen = recorded as Record<string, unknown>;
  const expected = current.snapshot;
  if (frozen.digest !== expected.digest || frozen.revision !== expected.revision
    || frozen.taxYear !== expected.taxYear || frozen.status !== expected.status) {
    throw new Error("FINAL_PAY_PRIOR_EMPLOYER_EVIDENCE_CHANGED");
  }
}
