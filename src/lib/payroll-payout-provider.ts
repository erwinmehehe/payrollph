/**
 * Default for newly initiated payroll payouts. Selecting Xendit does not
 * authorize a transfer: payout submission has its own employer-bound gates.
 * Existing PayMongo batches must remain on PayMongo for reconciliation.
 */
export type PayrollPayoutProvider = "xendit" | "paymongo";
export const DEFAULT_PAYROLL_PAYOUT_PROVIDER: PayrollPayoutProvider = "xendit";

export function configuredPayrollPayoutProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PayrollPayoutProvider {
  const chosen = (env.PAYROLL_PAYOUT_PROVIDER ?? DEFAULT_PAYROLL_PAYOUT_PROVIDER).trim().toLowerCase();
  if (chosen !== "xendit" && chosen !== "paymongo") {
    throw new Error("PAYROLL_PAYOUT_PROVIDER must be xendit or paymongo.");
  }
  return chosen;
}

export function xenditPayrollLiveReadiness(input: {
  organizationId: number;
  legalEntityId: number | null;
}, env: Readonly<Record<string, string | undefined>> = process.env) {
  const blockers: string[] = [];
  if (env.XENDIT_PAYOUTS_ENABLED !== "true") blockers.push("XENDIT_PAYOUTS_ENABLED is not true.");
  if (env.XENDIT_PAYOUTS_LIVE_APPROVED !== "true") {
    blockers.push("Independent Xendit payroll payout acceptance has not been approved.");
  }
  if (!env.XENDIT_PAYOUT_SECRET_KEY?.trim()) blockers.push("Dedicated Xendit MONEY-OUT secret is missing.");
  if (!env.XENDIT_PAYOUT_CALLBACK_TOKEN?.trim()) blockers.push("Xendit payout webhook token is missing.");
  if (!env.XENDIT_PAYOUT_BUSINESS_ID?.trim()) blockers.push("Xendit payout business ID is missing.");
  const orgId = Number(env.XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID);
  if (!Number.isSafeInteger(orgId) || orgId <= 0 || orgId !== input.organizationId) {
    blockers.push("Xendit payout credentials are not approved for this organization.");
  }
  const legalId = Number(env.XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID);
  if (!Number.isSafeInteger(legalId) || legalId <= 0 || legalId !== input.legalEntityId) {
    blockers.push("Xendit payout credentials are not approved for this legal employer.");
  }
  if (env.NODE_ENV === "production" && !env.APP_BASE_URL?.startsWith("https://")) {
    blockers.push("Production Xendit payout callback origin must use HTTPS.");
  }
  return { ready: blockers.length === 0, blockers };
}
