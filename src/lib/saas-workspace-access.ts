import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { getEntitlements } from "@/lib/billing";
import { publicSelfServeReady } from "@/lib/saas-launch-config";

/**
 * Only newly self-registered SaaS organizations have a payment gate.
 * Existing private pilots and preexisting customers retain current access.
 * Read-only access and exports are intentionally not blocked here so that
 * cancellation never holds employee and payroll records hostage.
 */
/**
 * A newly introduced signup table may not exist on older private-pilot
 * databases. Such databases cannot contain self-serve registration records;
 * they must not be made unusable by an unconditional SELECT of that table.
 * Never bypass the gate while new self-serve signup is enabled.
 */
export function legacySignupTableFallback(signupEnabled: boolean): false {
  if (signupEnabled) {
    throw new Error("Self-service billing migration is required before account access.");
  }
  return false;
}

export async function isSelfServeOrganization(organizationId: number): Promise<boolean> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("Valid organization context is required for the subscription gate.");
  }
  const presence = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.saas_signup_verifications') IS NOT NULL AS exists",
  );
  if (!presence.rows[0]?.exists) {
    // Only older deployments with public self-service disabled can proceed.
    // No signup records can exist if their authoritative table is absent.
    return legacySignupTableFallback(publicSelfServeReady());
  }
  const [row] = await db.select({ organizationId: saasSignupVerifications.organizationId })
    .from(saasSignupVerifications)
    .where(eq(saasSignupVerifications.organizationId, organizationId))
    .limit(1);
  return Boolean(row);
}

export async function requireSaasPaidWrites(organizationId: number): Promise<Response | null> {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "A valid organization is required." }, { status: 400 });
  }
  if (!(await isSelfServeOrganization(organizationId))) return null;
  const entitlements = await getEntitlements(organizationId);
  if (entitlements.active) return null;
  return Response.json({
    error: "This company needs an active, paid subscription to change payroll or employee records.",
    code: "SUBSCRIPTION_REQUIRED",
    subscriptionState: entitlements.status,
    billingUrl: "/billing/manage",
  }, { status: 402 });
}
