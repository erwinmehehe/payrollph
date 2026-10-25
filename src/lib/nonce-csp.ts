/**
 * Strict SCRIPT nonce policy for dynamically rendered Next.js pages.
 * CSS stays on the existing inline-style policy until audited separately.
 * This helper has no side effects; Proxy creates a fresh nonce per request.
 */
export function nonceContentSecurityPolicy(nonce: string, isDev = false): string {
  if (!/^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(nonce)) {
    throw new Error("CSP_NONCE_INVALID_BASE64");
  }
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'" +
      (isDev ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
