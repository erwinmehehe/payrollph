# Tenant isolation / pages — HR Work Queue

**Family:** `tenant-isolation/pages` (independent from the open CI, privileged-operations and invitation-acceptance PRs).

## Problem and bounded change

The previous `/hcm/work-items` page was a client-only shell with an editable organization selector. The underlying `GET/PATCH /api/hcm/work-items` methods already enforced session membership, role, company-wide authorization and organization-constrained SQL; the page itself did not establish a server-side tenant boundary before hydrating the editor.

This patch changes only the page boundary and its presentation:
- Require a valid signed-in session and one canonical positive `organizationId` in the page URL.
- Require the selected employer's current `PEOPLE_ADMIN_ROLES` grant, permission/session policy and company-wide scope before rendering the client queue. Deny malformed, duplicate and foreign selectors with `notFound()`.
- Pass an authorized numeric employer ID as a server prop to the client and remove the editable organization-ID input. Change employers by navigating through an authorized workspace URL, so Next.js rechecks server access.
- Keep `GET/PATCH /api/hcm/work-items` unchanged; each API request remains independently authorized. Existing filtering, editing, audit and SQL behavior stays in place.

## Scope boundaries

Only these files belong to this PR: `src/app/hcm/work-items/page.tsx`, `src/components/hcm-work-queue.tsx`, `src/lib/hcm-work-items-page-tenancy.ts`, `tests/hcm-work-items-page-isolation.test.ts`, and this document. No shared tenant method manifest, proof ledger, count, migrations, background jobs, transfer/payout controls, release flags, external service or production configuration change.

## Verification and acceptance gate

- Run `npx tsx --test tests/hcm-work-items-page-isolation.test.ts`, `npm run typecheck`, lint, affected contract tests and exact-head CI. New tests cover canonical selectors, the server authorization sequence, the single-employer client binding and the API's preserved tenant SQL checks.
- **Not yet proved:** an end-to-end browser/real-HTTP run against disposable PostgreSQL 16 with two independently signed-in own organizations, a third real higher-ID foreign employer, forged/duplicate selectors, revoked and unit-scoped membership, custom permission denies, and unchanged victim case/audit rows after rejected PATCHes. This needs a separate exact-head, independently reviewed proof before a page/action gap can be credited.
- Validate navigation to the page always supplies `?organizationId=<authorized employer>`; calls without it now return 404 instead of the former empty client shell. Confirm cross-employer transitions remount the client and do not carry over an editor or cached queue.
- This PR is a **bounded source hardening candidate**, not a claimed page/action proof credit or tenant-wide security certification. Do not change the 17 page/action GAP statuses just because these source tests pass.

## Rollback

Revert this PR only. The underlying API authentication and tenant-scoped SQL are unchanged and continue to guard the data.
