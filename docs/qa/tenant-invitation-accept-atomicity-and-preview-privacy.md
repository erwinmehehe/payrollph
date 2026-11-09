# Invitation acceptance isolation hardening — EDG-01 (draft)

Status: **SOURCE FIX / FICTIONAL PG16 VALIDATION PENDING / ZERO NEW COVERAGE CREDITS / NOT ACCEPTED**.

## Actual boundaries repaired

- `GET /api/invitations/accept` is an anonymous bearer-token preview. Valid token possession grants only the invitation's documented email, role, expiry, and validity. The endpoint must return `Cache-Control: no-store, max-age=0` and `Referrer-Policy: no-referrer` on **both** valid and invalid token responses, to reduce inadvertent caching/referrer exposure of a token-bearing URL. This does not eliminate exposure in upstream reverse-proxy/server logs, browser history, or link sharing.
- `POST /api/invitations/accept` now writes the `Invitation accepted` audit through the **same PostgreSQL transaction** that atomically marks the invitation claimed and inserts the account and membership. A failed audit INSERT must roll back all three changes. A rejected claim must never set an auth session cookie.

## Source-matched regression tests

- The existing independent real-HTTP preview runner still checks two distinct invitation owners, an actual higher-SQL-ID victim, six invalid/expired/redeemed token variants, forged selectors, and unchanged employer/account/audit snapshots. It now also enforces non-cacheable, no-referrer headers for successful **and denied** previews; its source-hash contract is updated to the new handler SHA.
- The existing `tenant-invitations-accept-http` runner preserves its two legitimate fictional independent invitation acceptances, poisoned foreign-unit rejections, origin check, claimed-token replay denial and higher-ID victim non-mutation. It now creates a **disposable PostgreSQL audit INSERT veto trigger**, asserts the valid invitation POST fails with 409 and **no cookie**, compares all source/audit/identity snapshots, drops the trigger, then proves the same invitation can be successfully claimed and audited. No production SQL migration is added.
- Contract tests reject audit-after-commit or silently detached audit writers, and reject preview caching or permissive referrer policies.

## Execution gates

Run the two dedicated path-scoped GitHub Actions workflows on this **exact PR head**:

- `tenant-invitation-preview-get-http.yml` (real PG16 and production-mode localhost HTTP)
- `tenant-invitations-accept-http.yml` (real PG16 and production-mode localhost HTTP, forced audit veto)

Also require applicable full CI, security checks, source-pin review and an independent identity/tenant/privacy review. Inspect the actual workflow job logs; do not claim success from static checks alone. No real employer data, production DB, email provider, payout, payroll or deployment is used.

**Both methods remain GAP** in the 498-method canonical manifest. The existing provisional **441 COVERED / 11 PUBLIC-BY-DESIGN / 46 GAP** counts remain unchanged, with **17 page/action gaps**. No credit, certification, migration, release authorization or automatic merge is requested.
