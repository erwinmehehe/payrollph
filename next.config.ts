import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      // Next/React dev tooling uses eval for debugging. NEVER permit it in
      // production, preview production builds, or production security smoke.
      "script-src 'self' 'unsafe-inline'" +
        (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
      process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
    ].filter(Boolean).join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

// Allow only the exact approved private QA hostname to reach the
// development server, without modifying any production Next.js behavior.
const privateTailnetDevHost = (() => {
  const raw = process.env.APP_BASE_URL;
  if (!raw || process.env.NODE_ENV === "production") return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.origin === raw && parsed.protocol === "https:" &&
      parsed.port === "" &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/.test(parsed.hostname)) {
      return parsed.hostname;
    }
  } catch { /* no private QA origin configured */ }
  return undefined;
})();

const nextConfig: NextConfig = {
  allowedDevOrigins: privateTailnetDevHost ? [privateTailnetDevHost] : undefined,
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/year-end/2316-certificate": ["./assets/bir/2316-september-2021-encs.pdf"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
