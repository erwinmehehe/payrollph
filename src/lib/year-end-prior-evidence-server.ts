import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, yearEndAdjustments, yearEndPriorEvidence } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";
import { decryptGovernmentId, encryptGovernmentId } from "./government-id-crypto";
import { assertPriorApproval, parsePriorEvidence, priorEvidenceDigest, type PriorScope } from "./year-end-prior-evidence";
import { assertEntityResource, resolveMultiEntityContext } from "./multi-entity-server";
export const priorEvidenceEnabled = () => criticalReleaseFlagEnabled("yearEndPriorEvidence");
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Scope = Pick<PriorScope, "organizationId" | "employeeId" | "taxYear">;
export async function priorEmployeeScope(tx: Transaction, scope: Scope): Promise<PriorScope> {
  const [employee] = await tx.select().from(employees).where(and(eq(employees.id, scope.employeeId), eq(employees.organizationId, scope.organizationId))).limit(1);
  if (!employee) throw new Error("PRIOR_EMPLOYEE_NOT_FOUND");
  return { ...scope, legalEntityId: employee.legalEntityId, startDate: employee.startDate, employeeTin: employee.tin };
}
export async function readPriorEvidence(tx: Transaction, scope: PriorScope, approved = false) {
  const [row] = await tx.select().from(yearEndPriorEvidence).where(and(eq(yearEndPriorEvidence.organizationId, scope.organizationId), eq(yearEndPriorEvidence.employeeId, scope.employeeId), eq(yearEndPriorEvidence.taxYear, scope.taxYear))).limit(1);
  if (!row) { if (approved) throw new Error("PRIOR_APPROVED_EVIDENCE_REQUIRED"); return null; }
  const evidence = parsePriorEvidence(JSON.parse(decryptGovernmentId(row.encryptedEvidence) ?? "null"), scope);
  const digest = priorEvidenceDigest(scope, evidence);
  if (digest !== row.sourceDigest) throw new Error("PRIOR_SOURCE_CHANGED");
  if (approved && (!row.approvedAt || !row.checkerUserId || row.checkerUserId === row.makerUserId)) throw new Error("PRIOR_APPROVED_EVIDENCE_REQUIRED");
  return { row, evidence };
}
export async function priorIntake(scope: Scope, actor: { id: number; name: string }, input?: { action: string; evidence?: unknown; expectedDigest?: string }) {
  if (!priorEvidenceEnabled()) throw new Error("PRIOR_DISABLED");
  // Organization-level payroll access does not imply access to every legal
  // employer in a multi-entity tenant. Resolve the *authenticated actor's*
  // grants before entering the encrypted evidence read/write transaction.
  const entityScope = await resolveMultiEntityContext({
    userId: actor.id, organizationId: scope.organizationId,
  });
  if (!entityScope.ok) throw new Error("PRIOR_ENTITY_ACCESS_DENIED");
  // Group HR is a read-only cross-employer role for aggregate reporting, not
  // permission to decrypt or amend employee-specific tax evidence.
  if (entityScope.context.enabled && entityScope.context.group)
    throw new Error("PRIOR_ENTITY_ACCESS_DENIED");
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payrollph.year-end.annualization'), hashtext(${scope.organizationId}::text || ':' || ${scope.taxYear}::text))`);
    const employeeScope = await priorEmployeeScope(tx, scope);
    // Re-evaluate the actual persisted worker employer inside this serializable
    // transaction, before decrypting or changing prior earnings. An employee
    // transfer or a forged employee ID must never widen the actor's grants.
    if (entityScope.context.enabled
      && assertEntityResource(entityScope.context, employeeScope.legalEntityId)) {
      throw new Error("PRIOR_ENTITY_ACCESS_DENIED");
    }
    if (!input) {
      const existing = await readPriorEvidence(tx, employeeScope);
      return existing ? { evidence: existing.evidence, digest: existing.row.sourceDigest, revision: existing.row.revision, approved: !!existing.row.approvedAt, makerUserId: existing.row.makerUserId } : null;
    }
    const adjustments = await tx.select().from(yearEndAdjustments).where(and(eq(yearEndAdjustments.organizationId, scope.organizationId), eq(yearEndAdjustments.employeeId, scope.employeeId), eq(yearEndAdjustments.taxYear, scope.taxYear)));
    if (adjustments.some(a => a.status !== "computed" || a.payrollRunId !== null)) throw new Error("PRIOR_SETTLED_OR_BOUND");
    // Saving a correction is allowed even if employee scope has changed. It always
    // clears approval; approval itself must match the current employee fingerprint.
    const [old] = await tx.select().from(yearEndPriorEvidence).where(and(eq(yearEndPriorEvidence.organizationId, scope.organizationId), eq(yearEndPriorEvidence.employeeId, scope.employeeId), eq(yearEndPriorEvidence.taxYear, scope.taxYear))).limit(1);
    if (input.expectedDigest !== (old?.sourceDigest ?? "")) throw new Error("PRIOR_SOURCE_CHANGED");
    if (input.action === "save") {
      const evidence = parsePriorEvidence(input.evidence, employeeScope);
      const sourceDigest = priorEvidenceDigest(employeeScope, evidence);
      const encryptedEvidence = encryptGovernmentId(JSON.stringify(evidence), { required: true })!;
      const values = { ...scope, sourceDigest, encryptedEvidence, revision: (old?.revision ?? 0) + 1, makerUserId: actor.id, checkerUserId: null, approvedAt: null, updatedAt: new Date() };
      if (old) await tx.update(yearEndPriorEvidence).set(values).where(eq(yearEndPriorEvidence.id, old.id));
      else await tx.insert(yearEndPriorEvidence).values(values);
    } else if (input.action === "approve") {
      const current = await readPriorEvidence(tx, employeeScope);
      if (!current) throw new Error("PRIOR_APPROVED_EVIDENCE_REQUIRED");
      assertPriorApproval({ digest: current.row.sourceDigest, expectedDigest: input.expectedDigest ?? "", makerId: current.row.makerUserId, checkerId: actor.id, settled: false });
      if (current.row.approvedAt) throw new Error("PRIOR_ALREADY_APPROVED");
      await tx.update(yearEndPriorEvidence).set({ checkerUserId: actor.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(yearEndPriorEvidence.id, current.row.id));
    } else throw new Error("PRIOR_ACTION_INVALID");
    await tx.insert(auditEvents).values({ organizationId: scope.organizationId, actor: actor.name, action: `Year-end prior evidence ${input.action}`, resource: `Employee #${scope.employeeId} / ${scope.taxYear}`, metadata: { employeeId: scope.employeeId, taxYear: scope.taxYear, actorUserId: actor.id, revision: input.action === "save" ? (old?.revision ?? 0) + 1 : old?.revision, plaintextPersisted: false } });
    return { saved: true };
  }, { isolationLevel: "serializable" });
}
