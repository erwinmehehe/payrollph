import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitations } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";

export { normalizeEmail, passwordIssues, validEmail } from "@/lib/validation";

export async function createInvitation(input: {
  organizationId: number;
  email: string;
  role: string;
  invitedBy: string;
  orgUnitId?: number | null;
}) {
  const token = randomToken(24);
  const [row] = await db.insert(invitations).values({
    organizationId: input.organizationId,
    email: input.email,
    role: input.role,
    orgUnitId: input.orgUnitId ?? null,
    tokenHash: sha256(token),
    invitedBy: input.invitedBy,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).returning();
  return { row, token };
}

export async function findUsableInvitation(token: string) {
  const [row] = await db.select().from(invitations).where(and(
    eq(invitations.tokenHash, sha256(token)),
    isNull(invitations.acceptedAt),
    gt(invitations.expiresAt, new Date()),
  )).limit(1);
  return row ?? null;
}
