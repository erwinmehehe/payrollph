import { eq } from "drizzle-orm";
import { db } from "@/db";
import { saasSignupVerifications } from "@/lib/saas-billing-schema";
import { getEntitlements } from "@/lib/billing";

/**
 * Only newly self-registered SaaS organizations have a payment gate.
 * Existing private pilots and preexisting customers retain current access.
 * Read-only access and exports are intentionally not blocked here so that
 * cancellation never holds employee and payroll records hostage.
 */
export async function isSelfServeOrganization(organizationId: number): Promise<boolean> {
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
