/**
 * Server-only, first-pilot OIDC configuration policy. This is an enumerated
 * security mode, not a new boolean *_ENABLED release flag: the central boolean
 * release registry is source-sealed by independent payroll evidence and may
 * not be casually re-pinned.
 *
 * "enabled" is only technical permission to exercise the existing OIDC code.
 * It is NOT identity/security/production approval or a safe rollout decision.
 */
export const OIDC_SSO_RUNTIME_POLICY = {
  env: "OIDC_SSO_RUNTIME_MODE",
  enabledValue: "enabled",
  owner: "Security / Identity",
  risk: "OIDC discovery and callback can link identities and create login sessions",
  approval: "Independent tenant, identity and privacy review, external IdP success/failure UAT, controlled rollout and final production signoff",
} as const;

export function oidcSsoRuntimeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[OIDC_SSO_RUNTIME_POLICY.env] === OIDC_SSO_RUNTIME_POLICY.enabledValue;
}

export function oidcSsoDisabledResponse(): Response {
  return Response.json({
    error: "SSO sign-in is not available.",
    code: "OIDC_SSO_RUNTIME_DISABLED",
  }, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
