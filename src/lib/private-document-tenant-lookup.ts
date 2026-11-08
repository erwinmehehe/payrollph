import { and, eq, exists, ne } from "drizzle-orm";
import { db } from "@/db";
import { documents, userOrganizations } from "@/db/schema";

/**
 * Limit path-ID document lookups to employers where the signed-in actor has
 * an ACTIVE, ordinary membership. This is a prefilter, not permission to
 * download or remove a document: route-specific role, worker, unit, MFA and
 * storage controls must still run after the bounded lookup.
 *
 * An unknown ID and a real document owned by an unrelated/revoked employer
 * both produce no row (404), without first reading a globally addressed
 * document and using its organization to choose an authorization check.
 * Group-HR membership alone must not authorize legacy document endpoints.
 */
export function documentVisibleToActiveMember(userId: number, documentId: number) {
  return and(
    eq(documents.id, documentId),
    exists(
      db.select({ id: userOrganizations.id }).from(userOrganizations).where(and(
        eq(userOrganizations.userId, userId),
        eq(userOrganizations.organizationId, documents.organizationId),
        eq(userOrganizations.active, true),
        ne(userOrganizations.role, "group_hr"),
      )),
    ),
  );
}
