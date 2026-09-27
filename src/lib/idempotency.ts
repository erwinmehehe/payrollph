import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";

/**
 * Returns a previously stored response when the same Idempotency-Key is
 * replayed, so a retried POST never creates a duplicate record.
 */
export async function findReplay(organizationId: number, keyValue: string, endpoint: string) {
  const [row] = await db.select().from(idempotencyKeys).where(and(
    eq(idempotencyKeys.organizationId, organizationId),
    eq(idempotencyKeys.keyValue, keyValue),
    eq(idempotencyKeys.endpoint, endpoint),
  )).limit(1);
  return row ?? null;
}

export async function storeReplay(input: {
  organizationId: number;
  keyValue: string;
  endpoint: string;
  responseStatus: number;
  responseBody: unknown;
}) {
  await db.insert(idempotencyKeys).values({
    organizationId: input.organizationId,
    keyValue: input.keyValue,
    endpoint: input.endpoint,
    responseStatus: input.responseStatus,
    responseBody: input.responseBody as never,
  }).onConflictDoNothing();
}
