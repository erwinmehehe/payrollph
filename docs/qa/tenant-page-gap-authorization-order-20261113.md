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
