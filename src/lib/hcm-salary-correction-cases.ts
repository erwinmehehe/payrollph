/**
 * #641 governed backdated salary correction cases.
 *
 * This module never computes or moves money. A case records a corrected pay
 * rate from an effective date, snapshots every affected Released payroll run
 * (with a fingerprint of the employee's entry), and requires each run to be
 * decided: either linked to a reviewed payroll_underpayment_requests row
 * (which carries the independently recalculated amount through its own
 * maker-checker and posting gate) or marked "no shortfall" with a reason.
 *
 * Submit and approval re-verify, inside one transaction:
 *   - the affected-run set is unchanged (a newly Released run blocks; refresh adds it),
 *   - every source run is still Released with an unchanged entry fingerprint,
 *   - no run for the period is still in progress (it may use the old rate),
 *   - no run is undecided (completeness),
 *   - linked requests still exist, are not rejected, and sum exactly to the
 *     declared total in integer centavos (reconciliation),
 *   - the employee's current pay profile already carries the corrected rate
 *     (the forward fix goes through the compensation approval flow, not here),
 *   - the approver is not the maker (also a database CHECK).
 */
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, employeePayProfiles, employeePayRevisions, employees, payrollEntries, payrollRuns,
  payrollUnderpaymentRequests, salaryCorrectionCaseRuns, salaryCorrectionCases,
} from "@/db/schema";
import { payrollSourceFingerprint } from "@/lib/payroll-underpayment";
import { positiveSalaryRateCents, validSalaryCorrectionDate } from "@/lib/hcm-salary-correction-preview";

export const MAX_AFFECTED_RUNS = 50;
export const ACTIVE_CASE_STATUSES = ["draft", "submitted", "changes_requested"] as const;
const EDITABLE_STATUSES = ["draft", "changes_requested"] as const;
const LINKABLE_REQUEST_STATUSES = ["pending_review", "posted"] as const;

export type CaseActor = { id: number; name: string };

export class SalaryCorrectionCaseError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "SalaryCorrectionCaseError";
  }
}
const fail: (code: string, message?: string) => never = (code, message) => {
  throw new SalaryCorrectionCaseError(code, message);
};

// ---------------------------------------------------------------- pure helpers

/** Strict PHP amount to integer centavos (0 allowed only where the caller permits). */
export function amountToCents(value: unknown, { allowZero = false } = {}): bigint | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (cents < BigInt(0) || cents > BigInt(10_000_000_000)) return null;
  if (!allowZero && cents === BigInt(0)) return null;
  return cents;
}

export function centsToDecimal(cents: bigint): string {
  return String(cents / BigInt(100)) + "." + String(cents % BigInt(100)).padStart(2, "0");
}

export function philippineToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

/**
 * Corrections reach back only within the current Philippine tax year and must
 * be strictly in the past. Crossing year-end changes the annual tax
 * reconciliation (BIR 2316), which belongs to the year-end adjustment flow.
 */
export function effectiveDateAllowed(effectiveDate: string, today: string): "ok" | "future" | "prior_tax_year" {
  if (effectiveDate >= today) return "future";
  if (effectiveDate.slice(0, 4) !== today.slice(0, 4)) return "prior_tax_year";
  return "ok";
}

export type CaseInput = {
  organizationId: number; legalEntityId: number; employeeId: number;
  effectiveDate: string; correctedPayBasis: "monthly" | "daily" | "hourly";
  correctedRateCents: bigint; evidenceReference: string; reason: string;
  idempotencyKey: string; expectedLatestRevisionId: number | null;
};

/** Validate a create request body. Throws SalaryCorrectionCaseError("INVALID_INPUT"). */
export function parseCaseInput(body: unknown): CaseInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("INVALID_INPUT", "A JSON object is required.");
  const b = body as Record<string, unknown>;
  const ids = ["organizationId", "legalEntityId", "employeeId"].map((key) => Number(b[key]));
  const basis = typeof b.correctedPayBasis === "string" ? b.correctedPayBasis.trim().toLowerCase() : "";
  const evidenceReference = typeof b.evidenceReference === "string" ? b.evidenceReference.trim() : "";
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  const idempotencyKey = typeof b.idempotencyKey === "string" ? b.idempotencyKey.trim() : "";
  const expected = b.expectedLatestRevisionId;
  let correctedRateCents: bigint | null = null;
  try { correctedRateCents = positiveSalaryRateCents(b.correctedRateAmount); } catch { correctedRateCents = null; }
  if (!ids.every((n) => Number.isSafeInteger(n) && n > 0)
    || !validSalaryCorrectionDate(b.effectiveDate)
    || !["monthly", "daily", "hourly"].includes(basis)
    || correctedRateCents === null
    || evidenceReference.length < 8 || evidenceReference.length > 200
    || reason.length < 20 || reason.length > 500
    || !/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey)
    || (expected !== undefined && expected !== null && (!Number.isSafeInteger(Number(expected)) || Number(expected) < 0))) {
    fail("INVALID_INPUT", "Provide employer, legal employer, employee, a past effective date, pay basis, a positive corrected rate, an 8-200 character evidence reference, a 20-500 character reason and a 16-64 character idempotency key.");
  }
  return {
    organizationId: ids[0], legalEntityId: ids[1], employeeId: ids[2],
    effectiveDate: b.effectiveDate as string, correctedPayBasis: basis as CaseInput["correctedPayBasis"],
    correctedRateCents: correctedRateCents as bigint, evidenceReference, reason, idempotencyKey,
    expectedLatestRevisionId: expected === undefined || expected === null ? null : Number(expected),
  };
}

/** Runs with no decision yet. Withdrawn runs belong to a cancelled case and never count. */
export function undecidedRuns<T extends { disposition: string }>(runs: readonly T[]): T[] {
  return runs.filter((run) => run.disposition === "pending");
}

/** Sum of linked request amounts in integer centavos. */
export function linkedTotalCents(amounts: readonly string[]): bigint {
  return amounts.reduce((sum, amount) => {
    const cents = amountToCents(amount);
    if (cents === null) fail("LINKED_AMOUNT_INVALID");
    return sum + (cents as bigint);
  }, BigInt(0));
}

// ------------------------------------------------------------ database helpers

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function audit(tx: Tx, organizationId: number, actor: CaseActor, action: string, caseId: number, metadata: Record<string, unknown>) {
  await tx.insert(auditEvents).values({
    organizationId, actor: actor.name, action, resource: `Salary correction case #${caseId}`,
    metadata: { caseId, actorUserId: actor.id, ...metadata },
  });
}

/** Every Released run of this employer whose period ends on/after the effective date and has an entry for the employee. */
async function affectedReleasedRuns(tx: Tx, organizationId: number, legalEntityId: number, employeeId: number, effectiveDate: string) {
  const rows = await tx.select({
    runId: payrollRuns.id, legalEntityId: payrollRuns.legalEntityId, status: payrollRuns.status,
    periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd, entry: payrollEntries,
  }).from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollEntries.employeeId, employeeId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.periodEnd, effectiveDate),
    ))
    .orderBy(asc(payrollRuns.periodStart), asc(payrollRuns.id), asc(payrollEntries.id));
  const byRun = new Map<number, typeof rows>();
  for (const row of rows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);
  const runs = [];
  for (const [runId, entries] of byRun) {
    if (entries.length !== 1) fail("SOURCE_ENTRY_COUNT", `Released run #${runId} must have exactly one entry for the employee before it can be corrected.`);
    if (entries[0].legalEntityId !== legalEntityId) fail("RUN_EMPLOYER_MISMATCH", `Released run #${runId} belongs to a different legal employer.`);
    const { entry, periodStart, periodEnd } = entries[0];
    runs.push({ runId, entryId: entry.id, hash: payrollSourceFingerprint(entry), periodStart: String(periodStart), periodEnd: String(periodEnd) });
  }
  return runs;
}

async function latestRevisionId(tx: Tx, organizationId: number, employeeId: number) {
  const [row] = await tx.select({ id: employeePayRevisions.id }).from(employeePayRevisions)
    .where(and(eq(employeePayRevisions.organizationId, organizationId), eq(employeePayRevisions.employeeId, employeeId)))
    .orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id)).limit(1);
  return row?.id ?? null;
}

async function lockCase(tx: Tx, organizationId: number, caseId: number) {
  const [row] = await tx.select().from(salaryCorrectionCases)
    .where(and(eq(salaryCorrectionCases.id, caseId), eq(salaryCorrectionCases.organizationId, organizationId)))
    .for("update");
  if (!row) fail("CASE_NOT_FOUND", "The correction case does not belong to this employer.");
  return row as typeof salaryCorrectionCases.$inferSelect;
}

async function caseRuns(tx: Tx, caseId: number) {
  return tx.select().from(salaryCorrectionCaseRuns)
    .where(eq(salaryCorrectionCaseRuns.caseId, caseId)).orderBy(asc(salaryCorrectionCaseRuns.periodStart), asc(salaryCorrectionCaseRuns.id));
}

function isUniqueViolation(error: unknown) {
  for (let node: unknown = error, i = 0; node && typeof node === "object" && i < 5; i += 1) {
    if ((node as { code?: unknown }).code === "23505") return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Full integrity check used by submit and approve. Returns the reconciled total.
 * Locks linked requests FOR SHARE so a concurrent underpayment decision waits.
 */
async function verifyCaseIntegrity(tx: Tx, correction: typeof salaryCorrectionCases.$inferSelect) {
  const runs = (await caseRuns(tx, correction.id)).filter((run) => run.disposition !== "withdrawn");
  const current = await affectedReleasedRuns(tx, correction.organizationId, correction.legalEntityId,
    correction.employeeId, String(correction.effectiveDate));
  const snapshot = new Set(runs.map((run) => run.payrollRunId));
  if (current.length !== runs.length || current.some((run) => !snapshot.has(run.runId))) {
    fail("AFFECTED_RUNS_CHANGED", "The set of Released payroll runs for this period changed. Refresh the case before submitting.");
  }
  const currentById = new Map(current.map((run) => [run.runId, run]));
  for (const run of runs) {
    const live = currentById.get(run.payrollRunId);
    if (!live || live.entryId !== run.payrollEntryId || live.hash !== run.sourceEntryHash) {
      fail("SOURCE_CHANGED", `The released payroll for run #${run.payrollRunId} no longer matches the case snapshot.`);
    }
  }
  // A run still in progress may have been calculated at the old rate. It must
  // be Released (then refreshed into the case) before the case can close.
  const [inFlight] = await tx.select({ runId: payrollRuns.id }).from(payrollEntries)
    .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRuns.organizationId, correction.organizationId),
      eq(payrollEntries.employeeId, correction.employeeId),
      ne(payrollRuns.status, "Released"),
      gte(payrollRuns.periodEnd, String(correction.effectiveDate)),
    )).limit(1);
  if (inFlight) fail("RUN_IN_PROGRESS", `Payroll run #${inFlight.runId} for this period is not Released yet. Release it, refresh the case, then submit.`);
  if (undecidedRuns(runs).length) fail("CASE_INCOMPLETE", "Every affected run must be linked to an underpayment request or marked no shortfall.");
  const requestIds = runs.flatMap((run) => (run.underpaymentRequestId == null ? [] : [run.underpaymentRequestId]));
  let amounts: string[] = [];
  if (requestIds.length) {
    const requests = await tx.select().from(payrollUnderpaymentRequests)
      .where(and(eq(payrollUnderpaymentRequests.organizationId, correction.organizationId), inArray(payrollUnderpaymentRequests.id, requestIds)))
      .for("share");
    const byId = new Map(requests.map((request) => [request.id, request]));
    for (const run of runs) {
      if (run.underpaymentRequestId == null) continue;
      const request = byId.get(run.underpaymentRequestId);
      if (!request || !(LINKABLE_REQUEST_STATUSES as readonly string[]).includes(request.status)
        || request.employeeId !== correction.employeeId || request.sourcePayrollRunId !== run.payrollRunId
        || request.sourcePayrollEntryId !== run.payrollEntryId || request.sourceEntryHash !== run.sourceEntryHash) {
        fail("LINKED_REQUEST_INVALID", `The underpayment request linked to run #${run.payrollRunId} was rejected, removed or no longer matches.`);
      }
    }
    amounts = requests.map((request) => String(request.amount));
  }
  const [profile] = await tx.select({ payBasis: employeePayProfiles.payBasis, rateAmount: employeePayProfiles.rateAmount })
    .from(employeePayProfiles)
    .where(and(eq(employeePayProfiles.organizationId, correction.organizationId), eq(employeePayProfiles.employeeId, correction.employeeId)))
    .limit(1);
  const correctedCents = amountToCents(String(correction.correctedRateAmount));
  if (!profile || profile.payBasis !== correction.correctedPayBasis || amountToCents(String(profile.rateAmount)) !== correctedCents) {
    fail("FORWARD_RATE_NOT_APPLIED", "Apply the corrected rate going forward through compensation approval before submitting this case.");
  }
  return { totalCents: linkedTotalCents(amounts), requestIds };
}

// ------------------------------------------------------------------ operations

export async function createCorrectionCase(input: CaseInput, actor: CaseActor, now = new Date()) {
  const window = effectiveDateAllowed(input.effectiveDate, philippineToday(now));
  if (window === "future") fail("EFFECTIVE_DATE_NOT_PAST", "A backdated correction date must be earlier than today in the Philippines.");
  if (window === "prior_tax_year") fail("PRIOR_TAX_YEAR", "Corrections before the current tax year change the annual reconciliation; use the year-end adjustment process.");
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sqlLock(4261, input.employeeId));
      const [existing] = await tx.select().from(salaryCorrectionCases).where(and(
        eq(salaryCorrectionCases.organizationId, input.organizationId),
        eq(salaryCorrectionCases.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing) {
        // A retry must be the same request from the same maker, not just the
        // same employee/rate. Never reuse another actor's case or silently
        // discard a changed legal employer, evidence packet or rationale.
        const same = existing.requestedByUserId === actor.id
          && existing.employeeId === input.employeeId
          && existing.legalEntityId === input.legalEntityId
          && String(existing.effectiveDate) === input.effectiveDate
          && existing.correctedPayBasis === input.correctedPayBasis
          && amountToCents(String(existing.correctedRateAmount)) === input.correctedRateCents
          && existing.evidenceReference === input.evidenceReference
          && existing.reason === input.reason
          && (input.expectedLatestRevisionId === null
            || (existing.baseRevisionId ?? 0) === input.expectedLatestRevisionId);
        if (!same) fail("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different correction.");
        return { correction: existing, runs: await caseRuns(tx, existing.id), replayed: true };
      }
      const [worker] = await tx.select().from(employees).where(and(
        eq(employees.organizationId, input.organizationId), eq(employees.id, input.employeeId))).limit(1);
      if (!worker || worker.legalEntityId !== input.legalEntityId) fail("EMPLOYEE_NOT_FOUND", "Employee not found in the selected legal employer.");
      if (input.effectiveDate < String(worker!.startDate)) fail("BEFORE_EMPLOYMENT_START", "The effective date predates the recorded employment start.");
      const latest = await latestRevisionId(tx, input.organizationId, input.employeeId);
      if (input.expectedLatestRevisionId !== null && input.expectedLatestRevisionId !== (latest ?? 0)) {
        fail("STALE_PAY_HISTORY", "Pay history changed after the preview was opened. Refresh the evidence.");
      }
      const affected = await affectedReleasedRuns(tx, input.organizationId, input.legalEntityId, input.employeeId, input.effectiveDate);
      if (!affected.length) fail("NO_AFFECTED_RUNS", "No Released payroll is affected; correct the rate going forward through compensation approval only.");
      if (affected.length > MAX_AFFECTED_RUNS) fail("TOO_MANY_AFFECTED_RUNS", `More than ${MAX_AFFECTED_RUNS} Released runs are affected; split the correction by period.`);
      const [correction] = await tx.insert(salaryCorrectionCases).values({
        organizationId: input.organizationId, legalEntityId: input.legalEntityId, employeeId: input.employeeId,
        idempotencyKey: input.idempotencyKey, effectiveDate: input.effectiveDate,
        correctedPayBasis: input.correctedPayBasis, correctedRateAmount: centsToDecimal(input.correctedRateCents),
        baseRevisionId: latest, evidenceReference: input.evidenceReference, reason: input.reason,
        status: "draft", requestedByUserId: actor.id, requestedBy: actor.name,
      }).returning();
      const runs = await tx.insert(salaryCorrectionCaseRuns).values(affected.map((run) => ({
        organizationId: input.organizationId, caseId: correction.id, payrollRunId: run.runId, payrollEntryId: run.entryId,
        sourceEntryHash: run.hash, periodStart: run.periodStart, periodEnd: run.periodEnd, disposition: "pending",
      }))).returning();
      await audit(tx, input.organizationId, actor, "Salary correction case opened", correction.id, {
        employeeId: input.employeeId, effectiveDate: input.effectiveDate, correctedPayBasis: input.correctedPayBasis,
        correctedRateAmount: correction.correctedRateAmount, baseRevisionId: latest,
        affectedRunIds: affected.map((run) => run.runId), evidenceReference: input.evidenceReference,
      });
      return { correction, runs, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) fail("ACTIVE_CASE_EXISTS", "This employee already has an open correction case; finish or cancel it first.");
    throw error;
  }
}

function sqlLock(namespace: number, key: number) {
  return sql`select pg_advisory_xact_lock(${namespace}, ${key})`;
}

type RunDecision =
  | { kind: "link"; runId: number; underpaymentRequestId: number }
  | { kind: "no_shortfall"; runId: number; reason: string }
  | { kind: "clear"; runId: number };

/** Maker-only edits while the case is a draft or has changes requested. */
export async function decideCaseRun(organizationId: number, caseId: number, decision: RunDecision, actor: CaseActor) {
  try {
    return await db.transaction(async (tx) => {
      const correction = await lockCase(tx, organizationId, caseId);
      if (!(EDITABLE_STATUSES as readonly string[]).includes(correction.status)) fail("CASE_NOT_EDITABLE", "Only a draft or returned case can be edited.");
      if (correction.requestedByUserId !== actor.id) fail("NOT_CASE_MAKER", "Only the person who opened the case can edit it.");
      const [run] = await tx.select().from(salaryCorrectionCaseRuns).where(and(
        eq(salaryCorrectionCaseRuns.id, decision.runId), eq(salaryCorrectionCaseRuns.caseId, caseId))).limit(1);
      if (!run || run.disposition === "withdrawn") fail("CASE_RUN_NOT_FOUND", "That payroll run is not part of this case.");
      let values: Partial<typeof salaryCorrectionCaseRuns.$inferInsert>;
      if (decision.kind === "link") {
        const [request] = await tx.select().from(payrollUnderpaymentRequests).where(and(
          eq(payrollUnderpaymentRequests.id, decision.underpaymentRequestId),
          eq(payrollUnderpaymentRequests.organizationId, organizationId))).for("share");
        if (!request) fail("REQUEST_NOT_FOUND", "The underpayment request does not belong to this employer.");
        if (!(LINKABLE_REQUEST_STATUSES as readonly string[]).includes(request!.status)) fail("REQUEST_NOT_LINKABLE", "Only a pending or posted underpayment request can be linked.");
        if (request!.employeeId !== correction.employeeId || request!.sourcePayrollRunId !== run!.payrollRunId
          || request!.sourcePayrollEntryId !== run!.payrollEntryId || request!.sourceEntryHash !== run!.sourceEntryHash) {
          fail("REQUEST_MISMATCH", "The underpayment request is for a different employee, run or payroll entry version.");
        }
        values = { disposition: "underpayment", underpaymentRequestId: request!.id, noShortfallReason: null };
      } else if (decision.kind === "no_shortfall") {
        const reason = decision.reason.trim();
        if (reason.length < 20 || reason.length > 500) fail("INVALID_INPUT", "A 20-500 character reason is required for no shortfall.");
        values = { disposition: "no_shortfall", underpaymentRequestId: null, noShortfallReason: reason };
      } else {
        values = { disposition: "pending", underpaymentRequestId: null, noShortfallReason: null };
      }
      const [updated] = await tx.update(salaryCorrectionCaseRuns).set({ ...values, updatedAt: new Date() })
        .where(eq(salaryCorrectionCaseRuns.id, run!.id)).returning();
      await tx.update(salaryCorrectionCases).set({ updatedAt: new Date() }).where(eq(salaryCorrectionCases.id, caseId));
      await audit(tx, organizationId, actor, "Salary correction case run decided", caseId, {
        runId: run!.payrollRunId, disposition: updated.disposition, underpaymentRequestId: updated.underpaymentRequestId,
      });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) fail("REQUEST_ALREADY_LINKED", "That underpayment request is already linked to another correction run.");
    throw error;
  }
}

/** Add Released runs that appeared after the case was opened, as undecided. */
export async function refreshCaseRuns(organizationId: number, caseId: number, actor: CaseActor) {
  return db.transaction(async (tx) => {
    const correction = await lockCase(tx, organizationId, caseId);
    if (!(EDITABLE_STATUSES as readonly string[]).includes(correction.status)) fail("CASE_NOT_EDITABLE", "Only a draft or returned case can be refreshed.");
    if (correction.requestedByUserId !== actor.id) fail("NOT_CASE_MAKER", "Only the person who opened the case can refresh it.");
    const existing = new Set((await caseRuns(tx, caseId)).map((run) => run.payrollRunId));
    const affected = await affectedReleasedRuns(tx, organizationId, correction.legalEntityId, correction.employeeId, String(correction.effectiveDate));
    if (affected.length > MAX_AFFECTED_RUNS) fail("TOO_MANY_AFFECTED_RUNS");
    const added = affected.filter((run) => !existing.has(run.runId));
    if (added.length) {
      await tx.insert(salaryCorrectionCaseRuns).values(added.map((run) => ({
        organizationId, caseId, payrollRunId: run.runId, payrollEntryId: run.entryId, sourceEntryHash: run.hash,
        periodStart: run.periodStart, periodEnd: run.periodEnd, disposition: "pending",
      })));
      await audit(tx, organizationId, actor, "Salary correction case refreshed", caseId, { addedRunIds: added.map((run) => run.runId) });
    }
    return { added: added.length };
  });
}

export async function submitCorrectionCase(organizationId: number, caseId: number, declaredTotal: unknown, actor: CaseActor) {
  const declaredCents = amountToCents(declaredTotal, { allowZero: true });
  if (declaredCents === null) fail("INVALID_INPUT", "Declare the case total in PHP with at most two decimals.");
  return db.transaction(async (tx) => {
    const correction = await lockCase(tx, organizationId, caseId);
    if (!(EDITABLE_STATUSES as readonly string[]).includes(correction.status)) fail("CASE_NOT_EDITABLE", "Only a draft or returned case can be submitted.");
    if (correction.requestedByUserId !== actor.id) fail("NOT_CASE_MAKER", "Only the person who opened the case can submit it.");
    const { totalCents, requestIds } = await verifyCaseIntegrity(tx, correction);
    if (totalCents !== declaredCents) {
      fail("TOTAL_MISMATCH", `The declared total does not equal the linked underpayment requests (${centsToDecimal(totalCents)}).`);
    }
    const [updated] = await tx.update(salaryCorrectionCases).set({
      status: "submitted", declaredTotal: centsToDecimal(declaredCents as bigint), submittedAt: new Date(),
      reviewedByUserId: null, reviewedBy: null, reviewedAt: null, reviewReason: null, updatedAt: new Date(),
    }).where(eq(salaryCorrectionCases.id, caseId)).returning();
    await audit(tx, organizationId, actor, "Salary correction case submitted", caseId, {
      declaredTotal: updated.declaredTotal, linkedUnderpaymentRequestIds: requestIds,
    });
    return updated;
  });
}

/** Independent checker decision. Approval records completeness; money posts only via each linked request's own review. */
export async function reviewCorrectionCase(organizationId: number, caseId: number, action: "approve" | "reject", reviewReason: string, actor: CaseActor) {
  const reason = reviewReason.trim();
  if (reason.length < 20 || reason.length > 500) fail("INVALID_INPUT", "A 20-500 character review reason is required.");
  return db.transaction(async (tx) => {
    const correction = await lockCase(tx, organizationId, caseId);
    if (correction.status !== "submitted") fail("CASE_NOT_SUBMITTED", "Only a submitted case can be reviewed.");
    if (correction.requestedByUserId === actor.id) fail("SELF_REVIEW", "Maker-checker: the person who opened the case cannot review it.");
    let totalCents: bigint | null = null;
    if (action === "approve") {
      ({ totalCents } = await verifyCaseIntegrity(tx, correction));
      if (totalCents !== amountToCents(String(correction.declaredTotal), { allowZero: true })) {
        fail("TOTAL_MISMATCH", "Linked underpayment amounts changed after submission.");
      }
    }
    const [updated] = await tx.update(salaryCorrectionCases).set({
      status: action === "approve" ? "approved" : "changes_requested",
      reviewedByUserId: actor.id, reviewedBy: actor.name, reviewedAt: new Date(), reviewReason: reason, updatedAt: new Date(),
    }).where(and(eq(salaryCorrectionCases.id, caseId), eq(salaryCorrectionCases.status, "submitted"))).returning();
    if (!updated) fail("CASE_NOT_SUBMITTED");
    await audit(tx, organizationId, actor, action === "approve" ? "Salary correction case approved" : "Salary correction case returned for changes", caseId, {
      reviewReason: reason, makerUserId: correction.requestedByUserId, reconciledTotal: totalCents === null ? null : centsToDecimal(totalCents),
    });
    return updated;
  });
}

/** Cancel an open case. Links are withdrawn (recorded in the audit event) so each request can be reused. */
export async function cancelCorrectionCase(organizationId: number, caseId: number, cancelReason: string, actor: CaseActor) {
  const reason = cancelReason.trim();
  if (reason.length < 20 || reason.length > 500) fail("INVALID_INPUT", "A 20-500 character cancellation reason is required.");
  return db.transaction(async (tx) => {
    const correction = await lockCase(tx, organizationId, caseId);
    if (!(ACTIVE_CASE_STATUSES as readonly string[]).includes(correction.status)) fail("CASE_NOT_OPEN", "Only an open case can be cancelled.");
    if (correction.requestedByUserId !== actor.id) fail("NOT_CASE_MAKER", "Only the person who opened the case can cancel it.");
    const runs = await caseRuns(tx, caseId);
    await tx.update(salaryCorrectionCaseRuns).set({
      disposition: "withdrawn", underpaymentRequestId: null, noShortfallReason: null, updatedAt: new Date(),
    }).where(eq(salaryCorrectionCaseRuns.caseId, caseId));
    const [updated] = await tx.update(salaryCorrectionCases).set({
      status: "cancelled", cancelledByUserId: actor.id, cancelledAt: new Date(), cancelReason: reason, updatedAt: new Date(),
    }).where(eq(salaryCorrectionCases.id, caseId)).returning();
    await audit(tx, organizationId, actor, "Salary correction case cancelled", caseId, {
      cancelReason: reason,
      withdrawn: runs.map((run) => ({ runId: run.payrollRunId, disposition: run.disposition, underpaymentRequestId: run.underpaymentRequestId })),
    });
    return updated;
  });
}

export async function listCorrectionCases(organizationId: number, legalEntityId: number | null = null) {
  // A company-wide role does not grant visibility into every legal employer
  // when the multi-entity gate is active. Filter before fetching case runs.
  const caseScope = legalEntityId === null
    ? eq(salaryCorrectionCases.organizationId, organizationId)
    : and(eq(salaryCorrectionCases.organizationId, organizationId), eq(salaryCorrectionCases.legalEntityId, legalEntityId));
  const cases = await db.select().from(salaryCorrectionCases)
    .where(caseScope)
    .orderBy(desc(salaryCorrectionCases.id)).limit(100);
  if (!cases.length) return [];
  const runs = await db.select().from(salaryCorrectionCaseRuns)
    .where(and(eq(salaryCorrectionCaseRuns.organizationId, organizationId), inArray(salaryCorrectionCaseRuns.caseId, cases.map((c) => c.id))))
    .orderBy(asc(salaryCorrectionCaseRuns.periodStart));
  const requestIds = runs.flatMap((run) => (run.underpaymentRequestId == null ? [] : [run.underpaymentRequestId]));
  const requests = requestIds.length
    ? await db.select({ id: payrollUnderpaymentRequests.id, status: payrollUnderpaymentRequests.status, amount: payrollUnderpaymentRequests.amount })
      .from(payrollUnderpaymentRequests)
      .where(and(eq(payrollUnderpaymentRequests.organizationId, organizationId), inArray(payrollUnderpaymentRequests.id, requestIds)))
    : [];
  const requestById = new Map(requests.map((request) => [request.id, request]));
  return cases.map((correction) => ({
    ...correction,
    runs: runs.filter((run) => run.caseId === correction.id).map((run) => ({
      ...run,
      underpaymentRequest: run.underpaymentRequestId == null ? null : requestById.get(run.underpaymentRequestId) ?? null,
    })),
  }));
}
