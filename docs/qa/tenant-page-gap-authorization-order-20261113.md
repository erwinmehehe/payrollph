# Tenant page isolation — source authorization order and open evidence gaps

**Scope:** Two server-rendered page guard-order hardenings, plus source-regression checks across the 16 remaining page/action GAP entries. **DRAFT; zero coverage promotions.**

The current inventory lists 16 page/action GAPs. Many are not demonstrated exploitable vulnerabilities: they have existing permission gates and separate, unaccepted fictional PostgreSQL HTTP proof candidates. Treat lack of accepted evidence separately from a confirmed source defect.

## Changes

- HR Cases staff page: reject an unapproved employer through the canonical role/session/custom-permission check **before** querying its staff access scope or mounting the client queue. Keep unit-scoped HR and payroll staff behavior unchanged.
- Report Builder page: enforce the selected employer's active role/session/custom-permission gate **before** looking up access scope or employer name. Preserve existing company-wide and role gates.
- Source-order regression test: track exactly the 16 remaining GAP pages, require dynamic SSR and recognizable server authorization for private pages, check Careers remains publication-only, and pin the fail-closed HCM multi-entity embargo.

No API handler, policy role list, database schema, payroll logic, tenant coverage state, feature flag, deployment, provider or production setting is changed. This work does **not** prove existing APIs, client interactions, legal-entity isolation, staff-case actions, approval flows or production readiness.

## Acceptance still required

1. Exact PR-head CI and CodeQL/security checks, plus the existing dedicated HR Cases and Report Builder fictional PG16 HTTP page tests.
2. Each page's own populated-session success, real higher-ID foreign denial, revoked membership and protected SQL invariants; for client-driven pages, hydrated browser/API interactions and legal-entity scope where applicable.
3. Independent tenant/security and HR/privacy review; only separately accepted, source-pinned receipts may change a GAP to COVERED.

There are still **16 page/action GAPs** at this review stage. No automatic deployment, payroll release, migrations, provider access, or coverage credit is authorized.

## Strict source-inventory reconciliation (PR #1959)

The initial guard-order PR changed two page blobs but omitted their updated entry-level source pins and line anchors in the central manifest. The subsequent repair modifies only the central tenant-isolation manifest, its strict inventory verification, and this note, in addition to the previously proposed five files:

- HR Cases: old page SHA 93ef058a785606fd00921b23b47c73436e308fbb -> current 0d384a61699a9183bfd4fa55665a0d1154031442. The manifest pins the exact reordered role/session gate and retains GAP. Dedicated fictional PG16 read-only HTTP already passed on the source-changing head: [run 43353976715 / job 131651456563](https://github.com/erwinmehehe/payrollph/actions/runs/43353976715/job/131651456563).
- Report Builder: old page SHA 4415282df5e859e004ae26662815d7b5f087657d -> current 24512c4c9f727ca02589e53da81cf38ffed264c9. The manifest pins the exact reordered employer gate and retains GAP; the earlier proof-job receipt remains historical and is not rewritten. Source-current fictional PG16 HTTP passed on the source-changing head: [run 43353976706 / job 131651456593](https://github.com/erwinmehehe/payrollph/actions/runs/43353976706/job/131651456593).
- All source-line anchors (ids, business, guards) for the two changed pages were re-derived from unchanged line contents and checked against the actual new blobs; no anchor was dropped or moved to a non-matching line.
- The strict coverage test now permits exactly these two source-hash-sealed, zero-credit exceptions; it rejects further unreviewed edits or silently converting either page to COVERED. Prior source evidence remains historical.
- The headline remains 498 API methods (457 provisionally COVERED, 23 PUBLIC, 12 privileged token-only, 6 GAP) and 21 scoped pages/actions (5 provisionally COVERED, 16 GAP).

The original two feature-ON PG16 results were successful but fresh final reconciliation-head CI is still required. This does not validate hydrated client actions, all multi-legal-employer HR privacy requirements, report POST/CSV, or production security. Independent HR/privacy/security review and owner release decision remain PENDING. No production database, provider or money action is authorized.
