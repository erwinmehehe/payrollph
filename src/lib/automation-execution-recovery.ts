import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { automationExecutions } from "@/db/schema";

type RetryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializes manual retry attempts on one source execution within PostgreSQL.
 * Keeping transaction mechanics behind this adapter prevents the workflow
 * engine from introducing its own authorization/transaction bypass layer.
 */
export async function withAutomationRetryTransaction<T>(
  organizationId: number,
  executionId: number,
  operation: (tx: RetryTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${organizationId}, ${executionId})`);
    return operation(tx);
  });
}

export async function persistAutomationRetryResult(
  tx: RetryTransaction,
  input: {
    organizationId: number;
    executionId: number;
    status: "completed" | "partial" | "failed";
    result: Array<Record<string, unknown>>;
    error: string | null;
  },
) {
  return tx.update(automationExecutions).set({
    status: input.status,
    result: input.result,
    error: input.error,
    updatedAt: new Date(),
  }).where(and(
    eq(automationExecutions.id, input.executionId),
    eq(automationExecutions.organizationId, input.organizationId),
  )).returning();
}
