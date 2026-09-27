import { db } from "@/db";
import { auditEvents } from "@/db/schema";

/**
 * Single audit writer used by every mutating route, so actor / timestamp / rule
 * version are recorded consistently rather than being sprinkled per endpoint.
 *
 * `organizationId` may be null for account-level events raised by a user with no
 * workspace membership (the audit row has a NOT NULL FK to organizations). Those
 * events are skipped rather than attributed to a guessed workspace, a missing
 * row is honest, a row pointing at the wrong company is not.
 */
export async function recordAuditEvent(input: {
  organizationId: number | null;
  actor: string;
  action: string;
  resource: string;
  metadata?: Record<string, unknown>;
}) {
  if (input.organizationId == null) return null;

  const [row] = await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    metadata: input.metadata ?? {},
  }).returning();
  return row;
}
