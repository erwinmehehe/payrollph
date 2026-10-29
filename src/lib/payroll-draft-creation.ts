import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys, payrollRuns } from "@/db/schema";
import { findPayrollPeriodConflict } from "./payroll-period-integrity";
import { payrollDraftIntentFingerprint, type PayrollDraftIntent } from "./payroll-draft-intent";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const endpoint = "payroll-draft:create:v1";
export class PayrollDraftConflict extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export function payrollDraftReceiptIdentity(input: PayrollDraftIntent, actorId: number, key: string) {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  return { keyValue: "payroll-draft:" + hash(JSON.stringify([input.organizationId, actorId, key])),
    requestHash: hash(payrollDraftIntentFingerprint(input)) };
}
export async function findPayrollDraftReplay(input: PayrollDraftIntent, actorId: number, key: string, executor: Pick<typeof db, "select"> = db) {
  const identity = payrollDraftReceiptIdentity(input, actorId, key);
  const [receipt] = await executor.select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.organizationId, input.organizationId), eq(idempotencyKeys.endpoint, endpoint),
    eq(idempotencyKeys.keyValue, identity.keyValue),
  )).limit(1);
  if (!receipt) return null;
  const body = receipt.responseBody as { version?: unknown; requestHash?: unknown; actorId?: unknown; runId?: unknown } | null;
  if (!body || body.version !== 1 || body.requestHash !== identity.requestHash || body.actorId !== actorId) {
    throw new PayrollDraftConflict("PAYROLL_DRAFT_KEY_CONFLICT", "This payroll attempt was already used with different details. Open Payroll to inspect the existing run.");
  }
  if (!Number.isSafeInteger(body.runId) || Number(body.runId) <= 0) {
    throw new PayrollDraftConflict("PAYROLL_DRAFT_RECEIPT_INVALID", "The saved payroll attempt could not be verified.");
  }
  const [run] = await executor.select().from(payrollRuns).where(and(
    eq(payrollRuns.id, Number(body.runId)), eq(payrollRuns.organizationId, input.organizationId),
  )).limit(1);
  if (!run || run.legalEntityId !== input.legalEntityId || run.scopeOrgUnitId !== input.scopeOrgUnitId
    || String(run.periodStart) !== input.periodStart || String(run.periodEnd) !== input.periodEnd || String(run.payDate) !== input.payDate) {
    throw new PayrollDraftConflict("PAYROLL_DRAFT_RECEIPT_INVALID", "The saved payroll run no longer matches this attempt. Refresh Payroll before acting.");
  }
  return run;
}

/** Caller must authorize the current user/employer/unit before invoking either helper. */
export async function createPayrollDraftOnce(input: PayrollDraftIntent, actorId: number, key: string | null,
  create: (tx: Tx) => Promise<typeof payrollRuns.$inferSelect>) {
  return db.transaction(async tx => {
    // Serialize different keys too: the overlap check outside this transaction is only a fast path.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"payroll-draft:" + input.organizationId}, 0))`);
    if (key) {
      const replay = await findPayrollDraftReplay(input, actorId, key, tx);
      if (replay) return { run: replay, replayed: true };
    }
    const conflict = await findPayrollPeriodConflict({ ...input, executor: tx });
    if (conflict) throw new PayrollDraftConflict("PAYROLL_PERIOD_CONFLICT", `Payroll overlaps existing run #${conflict.id}. Open Payroll to inspect it before creating another run.`);
    const run = await create(tx);
    if (key) {
      const identity = payrollDraftReceiptIdentity(input, actorId, key);
      await tx.insert(idempotencyKeys).values({ organizationId: input.organizationId, keyValue: identity.keyValue,
        endpoint, responseStatus: 201, responseBody: { version: 1, requestHash: identity.requestHash, actorId, runId: run.id } });
    }
    return { run, replayed: false };
  });
}
