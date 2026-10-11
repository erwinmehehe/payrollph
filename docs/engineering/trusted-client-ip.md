# Trusted client IP for rate limiting (S-1)

The rate limiter and session-device metadata share the clientIp() helper. Do not trust arbitrary client-submitted X-Forwarded-For or X-Real-IP headers.

## Vercel

Vercel deployments set VERCEL=1. The helper reads the last IP from x-vercel-forwarded-for, falling back to Vercel's overwritten x-forwarded-for. Vercel controls these headers at its ingress; do not set VERCEL=1 on arbitrary self-hosted app servers.

## Self-hosted reverse proxy

Set TRUSTED_PROXY_HOPS to the **exact** number (1-8) of trusted forwarding hops. Restrict ingress so direct public requests cannot bypass those proxies. Configure the final proxy to overwrite or append the actual peer address, rather than passing user-supplied X-Forwarded-For unchanged. The helper takes the value at that configured position from the right.

If the runtime is not Vercel and TRUSTED_PROXY_HOPS is absent or invalid, or a required address is malformed/missing, the helper uses one conservative "unknown" bucket; this prevents header rotation from granting fresh rate-limit buckets but can rate-limit unrelated users together. Verify proxy configuration before activation.

Login and forgot-password routes already enforce additional hashed email/account buckets, and the reset-password route has a token-based limiter. The IP bucket is defense in depth, not the only control.

## Review evidence and activation

- Node behavior tests: tests/trusted-client-ip.test.ts (spoofed forwarding header, Vercel fallback, reverse-proxy chain, malformed addresses, unknown fallback).
- CI must pass on the exact pull-request head: TypeScript, suite, build, CodeQL and security smoke.
- T2 security change. Independent security review and protected staging request tests are required before merge/deployment.
- On staging, demonstrate spoofed X-Forwarded-For values do not reset a known client's limiter. Confirm representative corporate proxy/NAT visitors and IPv6 clients are handled, and rollback by reverting the commit if necessary.
- This change does not configure ingress proxies or production environment variables and does not authorize production release.
