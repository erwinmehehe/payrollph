import { ne } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

/**
 * Production-only safety boundary shared by the public demo-switch endpoint
 * and the token-protected CI diagnostic. Never return organization details.
 * An unavailable database is NOT proof that demo provisioning is safe.
 */
export type DemoProvisioningBoundary =
  | "demo_only"
  | "blocked_non_demo_employer"
  | "unverified"
  | "non_production";

export async function productionDemoEmployerBoundary(): Promise<DemoProvisioningBoundary> {
  if (process.env.NODE_ENV !== "production") return "non_production";
  try {
    const [nonDemoEmployer] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(ne(organizations.name, "Loom & Local"))
      .limit(1);
    return nonDemoEmployer ? "blocked_non_demo_employer" : "demo_only";
  } catch {
    return "unverified";
  }
}
