# Opt-in nonce-based script CSP (NOT enabled or certified)

## Status

Source candidate only. Enable with \`NEXT_CSP_ENABLED=true\` **at build AND
runtime** on a dedicated synthetic-data staging deployment. The default is OFF;
existing static CSP headers and HCM fail-closed routing remain unchanged. No
production feature flag, runtime environment or deployment is changed here.

Next.js 16 nonces require dynamic HTML. Root layout opts into \`connection()\`
only in nonce mode, but Next.js build optimization, CDN caching and marketing
performance must be measured on the actual served SHA. Do not assume a successful
TypeScript check means working hydration. Production rollout requires explicit
owner/security authorization.

## Staging acceptance, on the exact served commit

1. Compare legacy mode OFF with mode ON: marketing, login, demo, role workspaces,
   HCM embargo, first payroll, employee self-service, mobile and 403/404/500 pages.
2. For two independent HTML page requests inspect headers and actual HTML: each
   response must use a distinct unpredictable CSP script nonce and its script
   tags must carry the matching nonce. No injected \`unsafe-inline\` or
   \`unsafe-eval\` is allowed in the production \`script-src\` directive.
3. Verify React hydration, form submissions, Next navigation/prefetch, analytics
   and third-party scripts, Next fonts, error/retry states, and in-browser
   console CSP violations on desktop and physical phones. Disable integrations
   that cannot meet policy; never broadly allow \`https:\` in \`script-src\`.
4. Run current-head typecheck, lint, full regressions, production build, served
   browser smoke and relevant security/HCM workflows before approval.
5. Measure marketing page SEO/TTFB/cache and hosting impact: nonce mode forces
   per-request dynamic HTML rather than static/ISR/PPR. Approve this trade-off
   explicitly or leave the feature OFF.
6. Recheck API no-store, worker health endpoints, security headers and CSP on
   error/redirect responses. Confirm fallback is a new deployment built with
   NEXT_CSP_ENABLED absent, not a runtime-only toggle of a stale build.

The legacy static CSP in next.config.ts is kept **only when OFF**; when ON,
Proxy sets the nonce CSP on HTML requests. Style directives still contain
\`'unsafe-inline'\` for CSS and need a separate compatibility pass.

No tenant/permission, bank, statutory, payout, database or payroll logic changes.
This PR is not production CSP certification.
