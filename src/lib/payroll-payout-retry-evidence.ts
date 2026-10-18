/**
 * A provider timeout can occur after funds were accepted. Only a matching
 * committed retry acknowledgement clears its pre-POST intent blocker.
 */
export const PAYMONGO_RETRY_INTENT_ACTION = "Payroll payout retry submission initiated via PayMongo";
export const PAYMONGO_RETRY_SUBMITTED_ACTION = "Payroll payout retry submitted via PayMongo";

type RetryEvidence = { action: string; metadata?: unknown };

function evidenceKey(event: RetryEvidence): string | null {
  const data = event.metadata;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const key = (data as Record<string, unknown>).idempotencyKey;
  return typeof key === "string" && key.trim() ? key : null;
}

export function hasUnacknowledgedPaymongoRetry(events: readonly RetryEvidence[]): boolean {
  const acknowledged = new Set(events
    .filter((event) => event.action === PAYMONGO_RETRY_SUBMITTED_ACTION)
    .map(evidenceKey)
    .filter((key): key is string => key !== null));
  return events.some((event) =>
    event.action === PAYMONGO_RETRY_INTENT_ACTION
    && (evidenceKey(event) === null || !acknowledged.has(evidenceKey(event)!))
  );
}

export function wasPaymongoRetryKeyAttempted(
  events: readonly RetryEvidence[],
  idempotencyKey: string,
): boolean {
  return events.some((event) =>
    (event.action === PAYMONGO_RETRY_INTENT_ACTION
      || event.action === PAYMONGO_RETRY_SUBMITTED_ACTION)
    && evidenceKey(event) === idempotencyKey
  );
}
