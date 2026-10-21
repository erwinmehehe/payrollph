import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, userOrganizations } from "@/db/schema";

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

/**
 * A successful local login has no selected workspace yet. Write one audit
 * receipt for each ACTIVE employer membership, not an arbitrary company.
 * The insert batch is atomic so a multi-employer login cannot be partially
 * certified as audited. Never store passwords, TOTP/backup codes, session
 * tokens, cookies or request IPs in login audit metadata.
 */
export async function recordSuccessfulLocalLogin(input: {
  userId: number;
  actor: string;
  mfaVerified: boolean;
}): Promise<number> {
  return db.transaction(async (tx) => {
    const memberships = await tx.select({
      organizationId: userOrganizations.organizationId,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, input.userId),
      eq(userOrganizations.active, true),
    ));
    if (memberships.length === 0) return 0;

    await tx.insert(auditEvents).values(memberships.map(({ organizationId }) => ({
      organizationId,
      actor: input.actor,
      action: "Successful local password sign-in",
      resource: "Account authentication",
      metadata: {
        userId: input.userId,
        authMethod: "local",
        mfaVerified: input.mfaVerified,
      },
    })));
    return memberships.length;
  });
}
