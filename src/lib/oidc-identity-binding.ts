import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { externalIdentities, identityProviders, userOrganizations, users } from "@/db/schema";

/** Persist only an already verified identity, after callback MFA policy checks.
 * Share locks keep account/provider disablement and membership revocation from
 * racing the identity write. This does not itself authenticate a token/session.
 */
export async function persistVerifiedOidcIdentity(input: {
  organizationId: number; providerId: number; userId: number;
  subject: string; email: string; existingIdentityId: number | null;
}): Promise<boolean> {
  return db.transaction(async tx => {
    const [provider] = await tx.select({ id: identityProviders.id }).from(identityProviders).where(and(
      eq(identityProviders.id, input.providerId),
      eq(identityProviders.organizationId, input.organizationId),
      eq(identityProviders.protocol, "oidc"), eq(identityProviders.enabled, true),
    )).limit(1).for("share");
    if (!provider) return false;
    const [user] = await tx.select({ email: users.email }).from(users).where(and(
      eq(users.id, input.userId), eq(users.active, true),
    )).limit(1).for("share");
    if (!user || user.email.toLowerCase() !== input.email) return false;
    const [membership] = await tx.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, input.userId),
      eq(userOrganizations.organizationId, input.organizationId),
      eq(userOrganizations.active, true),
    )).limit(1).for("share");
    if (!membership) return false;

    if (input.existingIdentityId !== null) {
      const [updated] = await tx.update(externalIdentities).set({
        email: input.email, lastLoginAt: new Date(),
      }).where(and(
        eq(externalIdentities.id, input.existingIdentityId),
        eq(externalIdentities.organizationId, input.organizationId),
        eq(externalIdentities.providerId, input.providerId),
        eq(externalIdentities.userId, input.userId),
        eq(externalIdentities.subject, input.subject),
      )).returning({ id: externalIdentities.id });
      return Boolean(updated);
    }
    await tx.insert(externalIdentities).values({
      organizationId: input.organizationId, providerId: input.providerId,
      userId: input.userId, subject: input.subject,
      email: input.email, lastLoginAt: new Date(),
    });
    return true;
  });
}
