# People/HR page tenant boundary — Engagement and Goals & Reviews

**Status: DRAFT, source + synthetic proof for independent review. No page/action or API method credits. NOT production-certified.** This is an independent People-page family based directly on main, separate from the open invitation-acceptance (#1872), privileged token-only operations (#1869), and CI scheduling (#1865) PRs.

## Scope and security invariant

Only the two SSR page entry points are modified:

- `/app/engagement`: require a canonical, positive employer selector when one is supplied; reject duplicates, scientific notation, leading zeros, whitespace, zero, negatives and out-of-range integers. On absent selection, preserve the existing *authenticated* primary-employer fallback. Before mounting the client shell, require an active company membership, verified single legal employer, and either a linked employee account or company-wide People administrator with canonical role/custom-permission authorization. The underlying `/api/hcm/engagement-surveys` remains an independent gate.
- `/app/goals-reviews`: same strict employer selector and absent-only authenticated primary fallback; keep People admin/custom-deny checks, company-wide access, single legal employer and the database `organizationId` predicate before any performance-cycle render.

The source already checked membership and organization scope. This hardening prevents malformed/duplicated tenant selectors from being coerced and prevents unit-only HR accounts from receiving an authorized-looking Engagement shell even though the API denies them. **No confirmed exploitable cross-tenant data leak is asserted.** The two pages are default-off behind existing flags; neither flag is enabled outside fictional CI.

## Executable evidence (new family only)

The dedicated `.github/workflows/tenant-people-pages-qa.yml` job checks out the **exact PR head**, runs adversarial pure tests first, and builds feature-ON Next.js against a fresh disposable PostgreSQL 16 `app_db` on `127.0.0.1`. The guard refuses non-CI/production proof modes, remote databases, external provider secrets, operational workers and payroll/financial flags.

The real-HTTP runner seeds **two distinct signed-in employer owners plus a real persisted higher-ID victim employer**, each with a distinguishable performance-cycle row and engagement-survey question. Both owner sessions must get populated own Goals SSR and the own private survey API, while direct foreign page requests return HTTP 404, survey API requests return HTTP 403, and employer markers cannot appear in refused responses. It tests duplicated/malformed selectors, an active unit-only HR member, anonymous redirects, and revocation of one real employer membership while the same user session remains authenticated. It snapshots employer, People, membership, payroll and audit SQL; only the deliberate membership-revocation row may change.

**Bounded proof only:** Engagement client interaction and response submission, survey privacy aggregation, employee-specific linked session, interactive browser hydration and underlying survey API POST are not claimed from these owner-only GET checks. They need their own targeted acceptance evidence. Page/action manifest entries remain GAP pending source-pinned exact-head CI and independent privacy/security approval. The shared manifest now carries **source-pinned unaccepted evidence** for these two pages, with both page/action statuses still GAP and zero credits. Exact-source inventory tests validate the new exception without weakening other historical GAPs. API method statuses/counts and all receipt credits remain unchanged. The source-only baseline test also recognizes the four owner-approved 2026-11-09 public classifications as public, never tenant-private. This creates review/merge overlap with open #1869/#1872; rebase/reconcile latest main before any merge.

## Maintainer review gates

- [ ] Dedicated exact-head PG16 HTTP job, normal CI and source checks green.
- [ ] Independent identity/security/privacy review verifies actual HTTP results and no hidden SSR/RSC victim values.
- [ ] Review primary-employer fallback behavior and unit-scoped HR denial against product navigation.
- [ ] No unapproved manifest promotion, feature activation, release, provider operation, or merge.

Rollback: revert this isolated People-page PR; all existing tenant-method credits, migrations, providers and production flags stay unchanged.
