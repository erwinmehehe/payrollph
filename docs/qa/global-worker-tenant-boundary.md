# Tenant boundary: token-only authorization for global background workers

**Status: draft source hardening. NOT ACCEPTED as tenant-wide isolation or production release.**

## Threat and scope

The following global HTTP actions are **not** owned by an individual employer:

- `POST /api/jobs/tick` invokes the scheduler, which can dispatch work for multiple employers.
- `POST /api/webhooks/drain` claims due webhook delivery retries across employer rows and can return delivery outcomes.

Before this change, production required a configured operational worker credential,
but non-production allowed any signed-in, same-origin browser session without a
worker credential. A regular tenant member's web session is not authorization to
trigger or observe global system work. **This is a source-level boundary finding;
no deployed data leak or real-world misuse is claimed.**

## Implemented boundary

The shared `requireGlobalWorkerToken` guard is required on both routes in
development, preview, test and production, *before* global scheduler or webhook
side effects. It:

- Refuses a missing operational worker secret with HTTP 503.
- Refuses a missing or invalid `x-worker-token` with HTTP 401.
- Uses the existing operational secret provider and constant-time comparison.
- Sets `Cache-Control: no-store` for denials.
- Provides **no** session-cookie or same-origin fallback.

The existing production deployment-SHA pin and scheduler worker-heartbeat gate
remain in place. A valid operational worker token can still invoke the same
existing work. A browser session, even when authenticated to its own employer,
cannot substitute for the worker credential.

## Evidence and acceptance

- Source contract: `tests/security.test.ts` requires both global routes to
  call the guard and forbids the prior browser-session fallback.
- Guard regression: `tests/global-worker-authorization.test.ts` denies
  unconfigured, cookie-only and forged-token requests and allows a legitimate
  fictional configured token.
- **Required, not yet executed on this PR:** exact-head TypeScript, focused
  tests, CI/security smoke and independent review. If a disposable local worker
  HTTP proof is added, use fictional companies and synthetic webhook endpoints
  only. Do not use customer accounts, live providers, Neon, production credentials
  or real payroll/money movement.
- Confirm existing internal dispatchers present `x-worker-token` in *all*
  environments that intentionally run these jobs. Without a configured worker
  secret, global jobs must remain unavailable rather than fall back to a
  tenant user session.

## Non-goals and explicit limits

No database or migration change; no payroll calculations, payout processing,
feature flag, deployment, scheduler frequency or webhook retry algorithm changed.
No API method is promoted to `COVERED` in the tenant-isolation manifest.
Outstanding per-method and page/action gaps remain open, and whole-system
tenant isolation is **NOT ACCEPTED**. A separate owner decision is required
before merging or deploying.
