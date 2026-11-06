# Company export tenant boundary hardening — draft source re-pin, no new credits

## Separate family and re-inventory
Only `GET /api/exports`, its source-owned parser, test, note, and **the mandatory one-method SHA entry** in the shared tenant-isolation coverage manifest are modified. No changes to shared coverage policy, promotion tests, migrations, payout, payroll engine or provider routes. The source-pin update can cause a **mechanical file conflict** with other open PRs that also touch the shared manifest; reconcile serially without discarding either method's evidence.

## Changes
- Require exactly one explicit, canonical positive `organizationId`, never implicit tenant 1.
- Authorize the authenticated session, active workspace membership and export role before employer-data reads. No GET-triggered `ensureSeedData()` write before authorization.
- Push organizational-unit restrictions into employee SELECT, and continue to apply existing legal-employer predicates.
- Select only employee, payroll or audit tables required by each export kind. The full JSON export still selects all three, with existing MFA and identifier masking.
- Serve all CSV/JSON downloads with private/no-store and nosniff headers.

## Historical coverage and new source
The **current main** manifest already classifies `GET /api/exports` as **provisionally COVERED** by historical two-owner fictional PG16 HTTP proof in `scripts/qa/tenant-high-risk-01-http.mjs`. The original source was `5a1156feb8d74d1f344e6e40e7bba8ebaee6849a`; this change pins the revised handler at `c7cabcccb0d618070ed0b36cfbeb8cd1aabc5584` while preserving the **same existing credit, not awarding a new one**. Historical HTTP proof is **not automatically transferable** to the new handler.

The previous CI run **Security HTTP Smoke** failed at the source-drift guard before the fresh cross-tenant acceptance could complete. That is why a source-only PR without updating the manifest could not pass CI. This commit reconciles the SHA and source metadata without relaxing the drift guard, changing the method's classification, or claiming completed acceptance.

## Required verification
- `npx tsx --test tests/company-export-tenant-boundary.test.ts`
- `npm run typecheck`
- Exact-final-PR-head **Security HTTP Smoke** in disposable PostgreSQL 16, which exercises `GET exports` for both real owners, a distinct populated victim employer, foreign-denial 403, and unchanged victim SQL snapshots.
- Independent security/coverage review to determine whether further evidence is needed for duplicate selectors, revoked membership and multi-entity ON/OFF cases.

**No new coverage method credits or new production authorizations.** Existing provisional credit is pending current-head revalidation. No production database, payment provider connection, money movement, or deployment.

## Dedicated acceptance expansion

`tenant-company-export-http.yml` now runs an isolated PG16/production Next
server twice, with legal-employer enforcement OFF and ON. It uses the strict
CI-only localhost guard, freshly created fictional employers and disposable
keys. Workers, providers and scanner are disabled. Existing shared proof lines,
runtime guards and deployed switches are unchanged.

The dedicated runner requires two own employee/payroll exports, a separately
working higher-ID victim, foreign/missing denial parity for every export kind,
duplicate/conflicting/malformed employer selectors, revoked membership,
unit-scoped roster filtering and denial of company-wide exports. With entity
enforcement ON it checks granted-entity filtering, denied ungranted/foreign IDs,
and conflicting header/query selectors; OFF it verifies the legacy full roster
and payroll behavior and MFA refusal for audit/full JSON. Denials must not write
export audits or seed data. Victim SQL remains unchanged after each attacker.
The CSV discriminator must reject another employer's rows.

**NOT_RUN for the new dedicated workflow:** source/contract tests are not HTTP
execution. The earlier current-head Security HTTP acceptance passed at
`12b7fcfb366ec33bdf7c765f1f6332a8c0b692b9` in
[run 42179543487](https://github.com/erwinmehehe/payrollph/actions/runs/42179543487/job/127771955873),
but it does not substitute for these additional cases. The new head must pass
both profiles and all applicable CI before source merge. Coverage promotion,
independent review and real-employer acceptance are not claimed.

Source merge follows the maintainer review/current-head checks in
`docs/engineering/change-risk-policy.md`; the independent review item above is
not an invented requirement for a second GitHub reviewer. Rollback is a source
revert, with no database migration or feature activation.
