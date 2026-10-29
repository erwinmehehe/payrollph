import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** HCM is intentionally unavailable while multi-entity scoping is unreviewed. */
export function multiEntityHcmDeferred(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return criticalReleaseFlagEnabled("multiEntity", env);
}

/**
 * Do not relax the multi-entity HCM embargo in a deployment. The exact
 * salary-preview POST may reach route authorization only inside its isolated
 * GitHub Actions PG16 HTTP proof. No client-controlled input opens this gate.
 */
export function multiEntityHcmRequestDeferred(
  pathname: string,
  method: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!multiEntityHcmDeferred(env)) return false;
  const isolatedSalaryPreviewProof =
    pathname === "/api/hcm/salary-corrections/preview" &&
    method === "POST" &&
    env.HCM_SALARY_CORRECTION_PREVIEW_ENABLED === "true" &&
    env.GITHUB_ACTIONS === "true" &&
    env.CI === "true" &&
    env.NODE_ENV === "production" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.DATABASE_URL === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    env.SECURITY_SMOKE_URL === "http://127.0.0.1:3000" &&
    env.DEMO_MODE === "false" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    env.XENDIT_BILLING_ENABLED === "false" &&
    !env.PAYMONGO_SECRET_KEY &&
    !env.XENDIT_SECRET_KEY &&
    !env.STRIPE_SECRET_KEY &&
    !env.POSTMARK_SERVER_TOKEN &&
    !env.RESEND_API_KEY;
  return !isolatedSalaryPreviewProof;
}
