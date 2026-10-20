import { ne } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import {
  PUBLIC_DEMO_DATABASE_IDENTITY_SQL, verifiedPublicDemoDatabaseIdentity,
} from "@/lib/public-demo-database-identity";

/**
 * One fail-closed production guard for both the public identity switch and
 * private readiness. An editable employer name is not trusted demo provenance.
 * No employer names, roles, database metadata or customer rows are returned.
 */
export type DemoProvisioningBoundary =
  | "demo_only"
  | "blocked_non_demo_employer"
  | "unverified"
  | "non_production";

export async function productionDemoEmployerBoundary(): Promise<DemoProvisioningBoundary> {
  if (process.env.NODE_ENV !== "production") return "non_production";
  try {
    // Keep the existing non-demo employer blocker even when identity pins are
    // not configured; a real employer always causes a controlled 404.
    const [nonDemoEmployer] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(ne(organizations.name, "Loom & Local"))
      .limit(1);
    if (nonDemoEmployer) return "blocked_non_demo_employer";

    // A duplicate reserved name or a customer name-collision must not be
    // treated as a unique verified fictional tenant.
    const candidates = await db.select({
      id: organizations.id, legalName: organizations.legalName,
    }).from(organizations).limit(2);
    if (candidates.length > 1 || candidates.some(org =>
      org.legalName !== "Loom & Local Philippines Inc.")) {
      return "blocked_non_demo_employer";
    }

    // Must be a dedicated operator-attested *runtime* PostgreSQL session.
    // Missing config, local PG, wrong Neon branch/role or DB read errors fail
    // closed, including for empty or exact-name-matching organization tables.
    const session = await db.execute(PUBLIC_DEMO_DATABASE_IDENTITY_SQL);
    return verifiedPublicDemoDatabaseIdentity(session.rows[0])
      ? "demo_only" : "unverified";
  } catch {
    return "unverified";
  }
}
