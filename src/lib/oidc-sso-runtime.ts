import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/**
 * Default-off first-pilot SSO hold. The three external entrypoints must
 * evaluate this before reading any request, employer or provider state.
 */
export function oidcSsoRuntimeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return criticalReleaseFlagEnabled("oidcSsoRuntime", env);
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
