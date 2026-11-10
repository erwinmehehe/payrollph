import { SAML_RUNTIME_BLOCK_REASON } from "@/lib/saml";

/**
 * SAML assertion verification is not implemented. Until a separately reviewed
 * runtime is installed, anonymous requests must not be able to determine
 * whether a particular tenant has an SAML provider configured or enabled.
 *
 * All provider IDs and all three public SAML entrypoints intentionally share
 * the same non-cacheable refusal; there are no database reads here.
 */
export function samlDisabledBoundaryResponse(): Response {
  return Response.json({
    error: SAML_RUNTIME_BLOCK_REASON,
    code: "SAML_RUNTIME_NOT_READY",
  }, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
